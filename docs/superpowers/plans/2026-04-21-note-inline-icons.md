# Note Pixaroma Inline Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users insert their own SVG icons inline into note text via a toolbar picker. Icons auto-scale with surrounding font-size, default to Pixaroma orange, re-color via the existing text-color picker.

**Architecture:** Drop-and-discover folder (`assets/icons/note/`) feeds a backend listing route. A new frontend module `js/note/icons.mjs` caches the list, injects per-icon CSS rules, and exposes an insert-at-caret handler. A toolbar button in Group 5 opens a compact popup picker; clicks produce `<span data-ic="..." class="pix-note-ic" style="color:#f66744"></span>` via the existing `insertAtSavedRange` helper so color staging stays sticky.

**Tech Stack:** Vanilla JS (`.mjs` modules) + CSS `mask-image` for tintable rendering + aiohttp for the backend list route. Zero new JS dependencies.

**Approved spec:** `docs/superpowers/specs/2026-04-21-note-inline-icons-design.md`

**Commit identity:** All commits use the one-shot identity:
```
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit ...
```

**Branch:** `Ioan` (local commits only — no push without explicit user request).

**No test suite.** Manual verification steps live inside each phase.

---

## File Structure

### Created

- `assets/icons/ui/icon-insert.svg` — placeholder toolbar-button icon. Phase 1 creates a simple sparkle glyph; user flagged to replace with the real artwork.
- `js/note/icons.mjs` — frontend icon module. Owns: list fetch + cache, CSS injection, label derivation, insert HTML rendering, insert handler `_insertInlineIcon`, popup builder `openIconPop`.

### Modified

- `server_routes.py` — add `GET /pixaroma/api/note/icons/list` route. Static asset serving for `assets/icons/note/*.svg` is already covered by the existing 2-subdir route.
- `js/note/index.js` — add one side-effect import so `icons.mjs` attaches `_insertInlineIcon` to the `NoteEditor` prototype at module load.
- `js/note/css.mjs` — base `.pix-note-ic` rule + popup styles (`.pix-note-iconpop`, `.pix-note-iconswatches`, `.pix-note-iconswatch`, `.pix-note-iconpop-empty`).
- `js/note/sanitize.mjs` — `ALLOWED_CLASS_VALUES` adds `pix-note-ic`; allow `data-ic` on `<span>` with regex `/^[A-Za-z0-9_-]{1,64}$/`.
- `js/note/toolbar.mjs` — Group 5 gets a new button between Grid and the Ln color picker. Click → `this._insertInlineIcon(btn)`.
- `CLAUDE.md` — two new entries in the task-to-file mapping, one new "Note Pixaroma Patterns" entry for the icons module.

---

## Phase 1: Placeholder toolbar icon + backend list route

**Files:**
- Create: `assets/icons/ui/icon-insert.svg`
- Modify: `server_routes.py:1-90` (add new route below existing asset-serving routes)

- [ ] **Step 1: Create the placeholder toolbar SVG**

Create `assets/icons/ui/icon-insert.svg` with this content (a four-pointed sparkle that reads as "insert an icon"):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M12 2 L13.5 9 L21 12 L13.5 15 L12 22 L10.5 15 L3 12 L10.5 9 Z"/>
</svg>
```

Single-path, fill=currentColor so the existing `.pix-note-tbtn-maskicon` class tints it from CSS.

- [ ] **Step 2: Add import for `os.path` helpers if missing**

Open `server_routes.py`. Verify line 1-10 already imports `os` and `web` (from aiohttp). No new imports needed — existing file already has them.

- [ ] **Step 3: Add the list route**

Append the following after the existing `serve_pixaroma_asset_sub2` function (around line 71, before the `PIXAROMA_INPUT_ROOT` block). Location matters — must be before line 74 to be associated with the asset-serving group:

```python
PIXAROMA_NOTE_ICONS_DIR = os.path.realpath(
    os.path.join(PIXAROMA_ASSETS_DIR, "icons", "note")
)


def _derive_icon_label(stem: str) -> str:
    """Derive a human-readable label from a kebab/snake filename stem.

    Rules (per spec 2026-04-21-note-inline-icons-design.md):
      - Split on '-' and '_'.
      - Preserve all-uppercase segments (CLIP, VAE, GGUF, LORA).
      - Lowercase mixed/lowercase segments.
      - Join with spaces.
      - Capitalize first letter of the result.
    """
    parts = re.split(r"[-_]", stem)
    mapped = []
    for p in parts:
        if p and p == p.upper() and any(c.isalpha() for c in p):
            mapped.append(p)
        else:
            mapped.append(p.lower())
    joined = " ".join(mapped).strip()
    if not joined:
        return stem
    return joined[0].upper() + joined[1:]


@PromptServer.instance.routes.get("/pixaroma/api/note/icons/list")
async def list_note_icons(request):
    """Enumerate the note inline-icon folder.

    Returns { "icons": [ { "id", "label", "url" }, ... ] } sorted by label.
    Empty list on error or missing folder — the frontend handles both
    empty-folder and route-failure with the same "No icons found" UI.
    """
    try:
        if not os.path.isdir(PIXAROMA_NOTE_ICONS_DIR):
            return web.json_response({"icons": []})
        entries = []
        for name in os.listdir(PIXAROMA_NOTE_ICONS_DIR):
            if not name.lower().endswith(".svg"):
                continue
            stem = name[:-4]
            # Slug must match the frontend sanitizer regex
            # /^[A-Za-z0-9_-]{1,64}$/ — reject anything else so we
            # never hand the frontend an id it would later strip.
            if not re.match(r"^[A-Za-z0-9_-]{1,64}$", stem):
                continue
            entries.append({
                "id": stem,
                "label": _derive_icon_label(stem),
                "url": f"/pixaroma/assets/icons/note/{name}",
            })
        entries.sort(key=lambda e: e["label"].lower())
        return web.json_response({"icons": entries})
    except Exception:
        # Never 500 on a listing failure — frontend treats empty list as
        # "no icons", which is the least-surprising UX.
        return web.json_response({"icons": []})
```

Note: `re` is already imported at the top of `server_routes.py` (used by `_SAFE_ID_RE`). If not, add `import re` to the imports.

- [ ] **Step 4: Verify the file parses**

Restart ComfyUI (or soft-reload the custom node). Check the console — no Python errors on startup. Import failure would log a stack trace at import time.

- [ ] **Step 5: Hit the route from a browser**

With ComfyUI running, visit:
```
http://<your-comfyui-host>:<port>/pixaroma/api/note/icons/list
```

Expected response shape:
```json
{"icons":[
  {"id":"CLIP","label":"CLIP","url":"/pixaroma/assets/icons/note/CLIP.svg"},
  {"id":"GGUF","label":"GGUF","url":"/pixaroma/assets/icons/note/GGUF.svg"},
  {"id":"LORA","label":"LORA","url":"/pixaroma/assets/icons/note/LORA.svg"},
  {"id":"VAE","label":"VAE","url":"/pixaroma/assets/icons/note/VAE.svg"},
  {"id":"ai-brain","label":"Ai brain","url":"/pixaroma/assets/icons/note/ai-brain.svg"},
  ...
]}
```

Expected: exactly 42 entries (matches the 42 SVGs the user dropped in the folder). Acronym filenames (CLIP / GGUF / LORA / VAE) keep their casing in both `id` AND `label`. Sort is by lowercased label, so acronyms appear alphabetically with everything else.

- [ ] **Step 6: Verify static asset serving still works**

Visit:
```
http://<your-comfyui-host>:<port>/pixaroma/assets/icons/note/CLIP.svg
```

Expected: SVG content returned. This confirms the existing 2-subdir route covers the new subfolder — no route changes needed for static serving.

- [ ] **Step 7: Commit**

```bash
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" add \
  assets/icons/ui/icon-insert.svg \
  server_routes.py
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "$(cat <<'EOF'
feat(note): placeholder toolbar SVG + backend icon-list route

Phase 1 of inline-icons feature.

- assets/icons/ui/icon-insert.svg: placeholder four-point sparkle.
  User flagged to replace with final artwork before shipping.
- server_routes.py: GET /pixaroma/api/note/icons/list returns
  {"icons": [{id, label, url}, ...]} sorted by label.
  Label derivation preserves acronyms (CLIP/VAE/GGUF/LORA).
  Returns empty list on any error — frontend treats empty list
  and route failure identically ("No icons found").

Static asset serving for assets/icons/note/*.svg is already
covered by the existing 2-subdir route — no route changes.

See: docs/superpowers/specs/2026-04-21-note-inline-icons-design.md
EOF
)"
```

---

## Phase 2: Frontend icon module + base CSS

**Files:**
- Create: `js/note/icons.mjs`
- Modify: `js/note/index.js` (add one side-effect import)
- Modify: `js/note/css.mjs` (append base `.pix-note-ic` rule — popup styles come in Phase 4)

- [ ] **Step 1: Create `js/note/icons.mjs` with the core module**

Create `js/note/icons.mjs` with the following contents. This phase covers ONLY the module + CSS injection; the insert handler and popup land in Phase 4.

```js
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
```

- [ ] **Step 2: Add the side-effect import to `js/note/index.js`**

Find the imports block at the top of `js/note/index.js` (where other note modules are imported for their side-effects, e.g. `./core.mjs`, `./toolbar.mjs`, `./blocks.mjs`, `./codeview.mjs`). Add one line:

```js
import "./icons.mjs";
```

Place it next to the other side-effect imports. Order: after `./blocks.mjs` but before anything that depends on it — effectively anywhere in the block is fine for now (Phase 4 will attach a prototype method, which must be loaded before toolbar wiring runs; side-effect imports are evaluated top-to-bottom at load time, so this works as long as it appears before the editor opens).

- [ ] **Step 3: Add the base `.pix-note-ic` CSS rule to `js/note/css.mjs`**

Find the `injectCSS` function in `js/note/css.mjs`. Append the following rule to the CSS string literal, in the same inline-elements section where anchor-pill styles live (near `.pix-note-btnblock` / `.pix-note-folderhint`):

```css
/* Inline icons: empty span rendered via mask-image + currentColor.
   Per-icon mask-image URLs come from the dynamically-injected
   <style id="pix-note-icon-css"> (see js/note/icons.mjs).
   Default: solid 1.2em×1.2em colored rectangle when no matching
   per-icon rule is present — deliberately visible to signal a
   missing / unknown icon rather than rendering invisibly. */
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
  /* Prevent the caret from entering the empty span itself */
  -webkit-user-modify: read-only;
       -moz-user-select: none;
            user-select: none;
}
```

- [ ] **Step 4: Preload icons on editor open**

Find the `open()` method in `js/note/core.mjs`. Near the top of the method — AFTER the initial Vue-detachment checks but BEFORE building the panel — add:

```js
// Preload inline-icon list + inject per-icon CSS rules so the toolbar
// picker opens instantly without a round-trip fetch. Both calls are
// idempotent (cache + one-time injection guards). Fire-and-forget —
// we never block editor open on the fetch.
import("./icons.mjs").then((m) => {
  m.ensureIcons().then(() => m.injectIconCSS());
});
```

Using `import()` (dynamic) keeps core.mjs from taking a hard compile-time dependency on icons.mjs — they already have a side-effect import order via index.js, but the dynamic form documents that this is a non-blocking preload.

- [ ] **Step 5: Verify CSS injection manually**

Reload ComfyUI's browser tab. Open a Note Pixaroma editor (double-click a Note node). In the browser DevTools Console, run:

```js
document.getElementById("pix-note-icon-css")?.textContent.split("\n").length
```

Expected: a number around 42 (one line per icon, possibly plus empty string if the last rule ends with `\n`). If the module is working, you'll see non-zero.

Then run:

```js
getComputedStyle(document.createElement("span")).getPropertyValue("mask-image")
```

That one doesn't prove much — but appending a `<span class="pix-note-ic" data-ic="CLIP">` to the DOM briefly and inspecting its computed `mask-image` should show `url(/pixaroma/assets/icons/note/CLIP.svg)`:

```js
const s = document.createElement("span");
s.className = "pix-note-ic";
s.setAttribute("data-ic", "CLIP");
s.style.color = "#f66744";
document.body.appendChild(s);
console.log(getComputedStyle(s).maskImage || getComputedStyle(s).webkitMaskImage);
s.remove();
```

Expected: `url("http://<host>/pixaroma/assets/icons/note/CLIP.svg")` or similar.

- [ ] **Step 6: Verify the base rule sizes correctly**

In the same DevTools, append a test span and read its dimensions:

```js
const s = document.createElement("span");
s.className = "pix-note-ic";
s.setAttribute("data-ic", "CLIP");
s.style.color = "#f66744";
s.style.fontSize = "16px";
document.body.appendChild(s);
const r = s.getBoundingClientRect();
console.log(`w=${r.width}px h=${r.height}px`);  // expect w=19.2 h=19.2 (1.2 × 16)
s.remove();
```

Expected: width and height close to `19.2px` (1.2em at 16px base font-size). Small rounding variance OK.

- [ ] **Step 7: Commit**

```bash
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" add \
  js/note/icons.mjs \
  js/note/index.js \
  js/note/css.mjs \
  js/note/core.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "$(cat <<'EOF'
feat(note): icons module + base CSS for inline icons

Phase 2 of inline-icons feature.

- js/note/icons.mjs: new module. ensureIcons() single-flight-fetches
  /pixaroma/api/note/icons/list and caches the array at module
  scope. injectIconCSS() builds per-icon .pix-note-ic[data-ic="..."]
  mask-image rules and appends a one-time <style id="pix-note-icon-
  css"> block to <head>. renderIconHTML() produces the exact insert
  shape the sanitizer expects.
- js/note/index.js: side-effect import of ./icons.mjs.
- js/note/css.mjs: .pix-note-ic base rule (1.2em, -0.15em baseline
  nudge, mask-image + currentColor). No fallback mask on purpose —
  a missing per-icon rule intentionally renders a 1.2em colored
  rectangle so broken/unknown icons are visible rather than silent.
- js/note/core.mjs: preload ensureIcons + injectIconCSS on editor
  open (fire-and-forget dynamic import; never blocks open).

No toolbar UI yet — Phase 4 wires the picker button + popup.
EOF
)"
```

---

## Phase 3: Sanitizer allowlist — `pix-note-ic` class + `data-ic` attribute

**Files:**
- Modify: `js/note/sanitize.mjs` (extend `ALLOWED_CLASS_VALUES` and add `data-ic` to the attribute allowlist with slug-regex validation)

- [ ] **Step 1: Find the class allowlist**

Open `js/note/sanitize.mjs`. Search for `ALLOWED_CLASS_VALUES` — it's an array or set of strings like `"pix-note-dl"`, `"pix-note-btnblock"`, `"pix-note-grid"`, etc.

- [ ] **Step 2: Add `pix-note-ic` to `ALLOWED_CLASS_VALUES`**

Add the string `"pix-note-ic"` to the array. Preserve alphabetical or grouping order if the file has a convention; otherwise append.

Example (exact placement depends on existing ordering):

```js
const ALLOWED_CLASS_VALUES = new Set([
  // ... existing entries ...
  "pix-note-grid",
  "pix-note-ic",           // ← new: inline-icon span marker
  // ... existing entries continue ...
]);
```

- [ ] **Step 3: Find the attribute-filtering logic**

Still in `sanitize.mjs`, search for where attributes are filtered on elements — typically a function like `filterAttributes` or `filterElement` that iterates over `el.attributes` and removes anything not in an allowlist. The existing pattern likely uses a per-tag allowlist (e.g. `href` allowed on `<a>`, `target`/`rel` allowed on `<a>`, etc.).

- [ ] **Step 4: Allow `data-ic` on `<span>` with regex validation**

Add a branch so a `<span>` with `class="pix-note-ic"` keeps its `data-ic` attribute when the value matches `/^[A-Za-z0-9_-]{1,64}$/`. On mismatch, strip only the attribute (keep the span per Pattern #1 unwrap-not-remove policy).

The exact integration depends on the current allowlist shape. The intent in pseudocode:

```js
// Inside the per-element attribute filtering loop, for <span> elements:
if (el.tagName === "SPAN" && el.classList.contains("pix-note-ic")) {
  const ic = el.getAttribute("data-ic");
  if (ic !== null) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(ic)) {
      el.removeAttribute("data-ic");
    }
    // else: leave the attribute intact
  }
}
```

Place this inside the existing attribute-cleaning path so it runs on every `<span>` the sanitizer sees. If the file uses an `ALLOWED_ATTRS` map keyed by tag, add `data-ic` to the span allowlist AND add the regex validation in a secondary pass.

- [ ] **Step 5: Verify the sanitizer round-trip**

Open a Note Pixaroma editor. Switch to Code view. Paste this HTML into the code view textarea, replacing whatever's there:

```html
<p>Model <span data-ic="CLIP" class="pix-note-ic" style="color:#f66744"></span> here.</p>
```

Switch back to Preview. Expected:
- The span survives (view source: Inspect the editor body, confirm `<span data-ic="CLIP" class="pix-note-ic" style="color:#f66744"></span>` is present).
- The icon renders as an orange CLIP glyph next to "Model".

- [ ] **Step 6: Verify sanitizer rejects malformed `data-ic`**

Switch to Code view again. Paste:

```html
<p>Bad <span data-ic="drop; expression(alert(1))" class="pix-note-ic" style="color:#f66744"></span> one.</p>
```

Switch back to Preview. Expected:
- Span survives (per unwrap-not-remove policy), but `data-ic` is stripped.
- Inspect: `<span class="pix-note-ic" style="color:#f66744"></span>` (no data-ic).
- Visible: a 1.2em × 1.2em orange rectangle (no mask-image match without a valid data-ic) — deliberately visible so the user notices.

- [ ] **Step 7: Verify Save + reload preserves a valid icon**

With the valid-icon note from Step 5 still open, press Save. Close the editor. Reopen. Expected: the icon is still there, renders orange, label unchanged.

- [ ] **Step 8: Commit**

```bash
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" add js/note/sanitize.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "$(cat <<'EOF'
feat(note): sanitizer allowlist for inline icons

Phase 3 of inline-icons feature.

- ALLOWED_CLASS_VALUES: add "pix-note-ic".
- Span data-ic attribute: allowed when value matches
  /^[A-Za-z0-9_-]{1,64}$/. Mismatch strips the attribute but keeps
  the span (unwrap-not-remove policy, Pattern #1). Mixed case is
  intentional — acronym filenames CLIP / VAE / GGUF / LORA are part
  of the shipped library and must round-trip.
- Slug is not cross-checked against the live icon list: drop-and-
  discover means user A's note may reference an icon user B doesn't
  have; sanitizer has no view into the filesystem.

Manual round-trip verified: valid icon survives, malformed data-ic
is stripped while keeping the span (renders as a visible colored
rectangle to signal "missing icon").
EOF
)"
```

---

## Phase 4: Toolbar button + popup picker

**Files:**
- Modify: `js/note/icons.mjs` (add `openIconPop` helper + `NoteEditor.prototype._insertInlineIcon`)
- Modify: `js/note/toolbar.mjs` (add button in Group 5, between Grid and Ln)
- Modify: `js/note/css.mjs` (append popup styles)

- [ ] **Step 1: Add popup styles to `js/note/css.mjs`**

In `injectCSS()`, append to the CSS string literal (near the existing `.pix-note-colorpop` / `.pix-note-swatches` block — same visual family):

```css
/* Inline-icons picker popup — mirrors .pix-note-colorpop in
   positioning + dismiss behaviour, but shows a scrollable icon grid
   instead of color swatches. */
.pix-note-iconpop {
  position: absolute;
  z-index: 1002;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.pix-note-iconswatches {
  display: grid;
  grid-template-columns: repeat(7, 32px);
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px; /* room for scrollbar on Windows */
}
.pix-note-iconswatch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
}
.pix-note-iconswatch:hover {
  border-color: #f66744;
  background: rgba(246, 103, 68, 0.15);
}
.pix-note-iconswatch .pix-note-ic {
  /* Inside the picker, render at a fixed 18px regardless of the
     document's font-size so tiles stay visually uniform. */
  width: 18px;
  height: 18px;
  vertical-align: middle;
}
.pix-note-iconpop-empty {
  color: #888;
  font-size: 12px;
  padding: 12px 6px;
  max-width: 220px;
  text-align: center;
  line-height: 1.4;
}
.pix-note-iconpop-empty code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  color: #ddd;
}
```

- [ ] **Step 2: Add `openIconPop` helper to `js/note/icons.mjs`**

Append to `js/note/icons.mjs`, below the existing exports:

```js
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
    // Intentional wording: tells the user exactly what to do + where.
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
      // Mousedown prevents the edit area from losing focus +
      // selection when the user clicks a tile.
      tile.addEventListener("mousedown", (e) => e.preventDefault());
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        onPick(ic.id);
        close();
      });
      const glyph = document.createElement("span");
      glyph.className = "pix-note-ic";
      glyph.setAttribute("data-ic", ic.id);
      glyph.style.color = "#f66744"; // preview in insert-color
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
```

- [ ] **Step 3: Add `_insertInlineIcon` to `NoteEditor.prototype` in `js/note/icons.mjs`**

Append below `openIconPop`:

```js
// Toolbar handler — opens the picker anchored to the button.
// Captures the saved range BEFORE the popup opens so the insert
// lands at the user's caret position (same pattern as
// _insertButtonBlock / _insertGridBlock in blocks.mjs).
//
// Delegates the actual DOM mutation to insertAtSavedRange() in
// blocks.mjs, which already calls _restageColors() after the insert
// — surrounding text color stays sticky for the next keystroke.
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
    // Lazily import insertAtSavedRange to avoid a hard circular
    // dependency icons.mjs ↔ blocks.mjs at module load. The dynamic
    // import resolves synchronously after the first call because of
    // ES module caching.
    import("./blocks.mjs").then((m) => {
      // m.default is undefined (blocks.mjs is side-effect only), so
      // we re-implement the insert via execCommand directly —
      // matches insertAtSavedRange's two-line body. The restage is
      // important: a picked text color should stay sticky after the
      // icon insert.
      if (savedRange) {
        this._editArea.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      document.execCommand(
        "insertHTML",
        false,
        renderIconHTML(id, "#f66744"),
      );
      this._restageColors?.();
      this._dirty = true;
      this._refreshActiveStates?.();
    });
  });
};
```

- [ ] **Step 4: Add the toolbar button in `js/note/toolbar.mjs`**

Find the Group 5 build block in `_buildToolbar` — search for the comment `// Group 5 — inserts` and the line `const g5 = el("div", "pix-note-tgroup");`. The Group 5 group currently contains (in order): linkBtn, codeBlockBtn, separator button, gridBtn, lnColorBtn.

Insert the icon-picker button AFTER gridBtn and BEFORE lnColorBtn. Locate the `g5.appendChild(gridBtn);` line. Between it and the `const lnColorBtn = makeColorPicker(...)` block, insert:

```js
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
```

Then add a matching mask-icon CSS rule in `js/note/css.mjs`, next to the other `.pix-note-icon-<name>` single-layer rules:

```css
.pix-note-icon-icon-insert {
  -webkit-mask-image: url(/pixaroma/assets/icons/ui/icon-insert.svg);
          mask-image: url(/pixaroma/assets/icons/ui/icon-insert.svg);
}
```

- [ ] **Step 5: Verify the button appears and is clickable**

Reload ComfyUI's browser tab. Open a Note Pixaroma editor. Expected:
- Group 5 shows, in order: Link, Code, Separator, Grid, **Icon-insert (sparkle)**, Ln picker.
- Hovering the new button shows title "Insert icon".

- [ ] **Step 6: Verify the popup opens with all 42 icons**

Click the icon-insert button. Expected:
- Popup anchored directly under the button.
- Grid of 7 columns, 6 full rows + partial 7th (42 icons total).
- All icons render in Pixaroma orange (`#f66744`).
- Scrollable — scroll to confirm all icons are reachable.
- Hover a tile → browser tooltip shows the derived label (e.g. hover CLIP tile → "CLIP"; hover `arrow-down` tile → "Arrow down").

- [ ] **Step 7: Verify insertion at caret**

Type some text in the editor. Position the cursor in the middle. Click the icon button, click the CLIP tile. Expected:
- Popup closes.
- Icon inserted exactly at the caret position — orange, matching the text's font-size, sitting on the baseline.
- Text to the right of the caret is preserved.
- Typing resumes after the icon.

- [ ] **Step 8: Verify all 4 acronym icons round-trip**

Insert CLIP, GGUF, LORA, VAE (one at a time). Each should render correctly. Save. Close the editor. Reopen. All four should still be visible and correctly positioned.

- [ ] **Step 9: Verify the empty-state message**

Temporarily rename `assets/icons/note/` to `assets/icons/note-backup/`. Reload the browser. Open a note, click the icon button. Expected:
- Popup shows the "No icons found. Drop SVG files into `assets/icons/note/` and reload the browser." message instead of a grid.
- Message is centered, readable, `code` element visually set off.

Restore the folder name after verification.

- [ ] **Step 10: Commit**

```bash
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" add \
  js/note/icons.mjs \
  js/note/toolbar.mjs \
  js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "$(cat <<'EOF'
feat(note): toolbar icon picker + popup — inline icons shippable

Phase 4 of inline-icons feature — end-to-end insert now working.

- js/note/icons.mjs: openIconPop() popup helper + prototype method
  NoteEditor._insertInlineIcon. Captures saved range sync before
  the async icon fetch; restores + execCommand inserts + calls
  _restageColors so surrounding text color stays sticky (Pattern
  #25). Empty-state branch renders a centered friendly message.
- js/note/toolbar.mjs: Group 5 gets a new button between Grid and
  the Ln color picker, using assets/icons/ui/icon-insert.svg as a
  single-layer mask-icon. Click opens the popup.
- js/note/css.mjs: .pix-note-iconpop / -iconswatches / -iconswatch /
  -iconpop-empty styles for the picker. .pix-note-icon-icon-insert
  mask rule for the toolbar button.

Empty state verified by temp-renaming the assets/icons/note/ dir
and reloading — popup shows "No icons found. Drop SVG files into
assets/icons/note/ and reload the browser."
EOF
)"
```

---

## Phase 5: Integration verification + CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` (task-to-file rows + new Note Pixaroma Pattern entry)

This phase only modifies documentation. The code is complete at the end of Phase 4; this phase proves the full matrix of user-facing behaviors works and records lessons for future AI agents.

- [ ] **Step 1: Full insert → save → reload cycle in the editor**

Open a fresh Note Pixaroma node on the ComfyUI canvas. Double-click to open the editor. Type:

```
Model: [cursor here]
```

Click icon-insert button → pick CLIP. Expected: the CLIP icon appears after "Model: ".

Click Save. Editor closes, canvas note renders with the CLIP icon beside "Model:". Double-click to reopen. Icon still there.

- [ ] **Step 2: On-canvas rendering verification**

With the note from Step 1 saved, zoom in/out on the ComfyUI canvas. The icon should:
- Render at the same font-size as surrounding text.
- Stay orange.
- Remain sharp at all zoom levels (SVG resolution-independent).

- [ ] **Step 3: Heading scale verification**

Open the editor from Step 1. Add a new line. Apply H1 heading. Insert VAE icon. Expected: VAE icon renders proportionally larger than the body-text CLIP icon (scales with heading font-size). Do the same for H2 and H3.

- [ ] **Step 4: Text-color picker recolors existing icon**

In the same note, click to place caret right next to the VAE icon. Select across the icon (shift+arrow or double-click the icon if the browser supports it — otherwise drag-select across it). With the icon selected, click the text-color picker (the "A" icon in Group 3) and pick blue (`#4a90e2`). Expected: the VAE icon turns blue. The CLIP icon remains orange.

- [ ] **Step 5: Code view round-trip**

Switch to Code view. Expected: the spans are visible and syntax-highlighted, e.g.
```html
<span data-ic="CLIP" class="pix-note-ic" style="color:#f66744"></span>
```
Switch back to Preview. All icons render as before — no loss, no reflow.

- [ ] **Step 6: Backspace deletion**

Place caret to the RIGHT of the CLIP icon. Press Backspace once. Expected: icon deleted in one keystroke, caret now at the "Model: " position.

- [ ] **Step 7: Backend-failure graceful handling**

Stop ComfyUI. Reload the browser (now the backend is offline). Double-click a note — the editor may refuse to open (Vue frontend might 404), but if it does open, click the icon-insert button. Expected: popup shows "No icons found" instead of throwing.

Restart ComfyUI before proceeding.

- [ ] **Step 8: Sticky-color integration**

With the sticky-color fix from commit `ff2f38e` in play: pick orange in the text-color picker, click elsewhere (caret moves to a fresh spot), insert an icon. Expected: icon is orange (inserted with its own explicit color). Type a character after the icon — character is orange (sticky color, applied by `_restageColors` on the post-insert caret move).

- [ ] **Step 9: Update CLAUDE.md — task-to-file mapping**

Open `CLAUDE.md`. Find the "Token-Saving Rules for AI Agents" section and locate the "Use the file names to find code" table. Add these two rows in the Note-related block (after the existing Note entries):

```markdown
| Add / manage inline note icons (SVG library) | Drop SVGs into `assets/icons/note/`. Label derivation + list endpoint live in `server_routes.py`'s `/pixaroma/api/note/icons/list` and mirror in `js/note/icons.mjs::deriveLabel`. Both must stay in sync if you change the rules. |
| Change inline-icon rendering (size / alignment / color model) | `js/note/css.mjs` base `.pix-note-ic` rule + per-icon rules dynamically injected by `js/note/icons.mjs::injectIconCSS`. Picker popup styles: `.pix-note-iconpop` family in `css.mjs`. |
```

- [ ] **Step 10: Update CLAUDE.md — add a new Note Pixaroma pattern**

In the "Note Pixaroma Patterns (do not regress)" section, append pattern #29:

```markdown
29. **Inline icons render via `<span data-ic="<slug>" class="pix-note-ic" style="color:...">` with per-icon mask-image rules dynamically injected at editor open** — icons are a THREE-file contract: `server_routes.py` enumerates `assets/icons/note/*.svg` and returns `{id, label, url}` via `/pixaroma/api/note/icons/list`; `js/note/icons.mjs` caches the list at module scope and injects one `.pix-note-ic[data-ic="<id>"] { mask-image: url(...) }` rule per icon into a single `<style id="pix-note-icon-css">` at `<head>`; `js/note/sanitize.mjs` allows `pix-note-ic` class + `data-ic` attribute validated against `/^[A-Za-z0-9_-]{1,64}$/`. Any of those three going out of sync with the others breaks the feature silently. Slug case is preserved (CLIP / GGUF / LORA / VAE are intentional acronym filenames). Missing per-icon rule renders the span as a solid 1.2em colored rectangle — deliberately visible so the user notices a broken icon rather than an invisible gap. Color defaults to #f66744, lives as inline `style="color:..."`, is recolored by the existing text-color picker via standard `execCommand("foreColor")`. No pencil — delete + re-insert. If you add a NEW inline-marker class (different kind of inline element), follow this pattern: base class for layout + data-attr for identity + dynamically injected per-value CSS rule — NOT one class per variant (unmanageable with drop-and-discover libraries).
```

- [ ] **Step 11: Commit**

```bash
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" add CLAUDE.md
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "$(cat <<'EOF'
docs(claude): inline-icons — task map + pattern #29

Phase 5 of inline-icons feature — docs-only.

- Task-to-file mapping: two new rows covering (a) where the icon
  library lives + how labels are derived (with the warning that
  backend + frontend derivation rules must stay in sync), and
  (b) where to edit rendering.
- Patterns: #29 captures the three-file contract (server_routes.py
  list endpoint ↔ js/note/icons.mjs cache+inject ↔
  js/note/sanitize.mjs allowlist). Calls out case-preserving slugs
  (CLIP / VAE etc.), the deliberately-visible missing-icon
  rectangle, and the pattern for future inline-marker classes.

All Phase 1-4 functionality verified manually end-to-end:
- Insert + save + reload cycle OK.
- On-canvas render at multiple zoom levels OK.
- Heading scale (H1/H2/H3) OK.
- Text-color picker recolor OK.
- Code view round-trip OK.
- Backspace deletion OK.
- Backend-offline empty-state OK.
- Sticky-color integration (Pattern #25) OK.
EOF
)"
```

- [ ] **Step 12: Flag the placeholder icon to the user**

After Phase 5 commits, surface a reminder in the session (not in the commit log):

> Phase 1 shipped `assets/icons/ui/icon-insert.svg` as a placeholder four-point sparkle. Replace with the final artwork before users see it. The filename and mask-icon class (`.pix-note-icon-icon-insert`) should stay the same — only the SVG contents need to change.

---

## Self-Review

### Spec coverage

Walking the spec (`docs/superpowers/specs/2026-04-21-note-inline-icons-design.md`) section by section:

- **Storage & discovery** (folder + filename conventions + label rules): Phase 1 (backend label derivation) + Phase 2 (frontend module with matching `deriveLabel`).
- **Backend route shape**: Phase 1.
- **Frontend module & data flow** (cache, CSS inject, render HTML): Phase 2.
- **DOM shape of inserted icon**: Phase 2 (`renderIconHTML`) + Phase 4 (`_insertInlineIcon` actually inserts it).
- **Base CSS + per-icon rules**: Phase 2.
- **Sanitizer additions**: Phase 3.
- **Toolbar button & picker popup**: Phase 4.
- **Code view round-trip**: No code changes needed per spec; verified in Phase 5 Step 5.
- **Paste behavior**: Unchanged per spec (plain-text strip is fine for v1). No task.
- **Edge cases — deleted file**: Verified visually via the "colored rectangle" rule in Phase 2 CSS + Phase 3 malformed-slug test.
- **Edge cases — backend failure**: Verified in Phase 5 Step 7.
- **Edge cases — caret positioning after insert**: Implicitly handled by `insertAtSavedRange` / `_restageColors` in Phase 4.
- **Testing scenarios 1-9**: Mapped to Phase 5 Steps 1-9 respectively.

No gaps.

### Placeholder scan

- No "TBD" / "TODO" / "implement later" markers in the plan.
- No vague "add appropriate X" instructions — every step specifies exact content.
- All steps that change code include the actual code block.

### Type consistency

- Slug regex `/^[A-Za-z0-9_-]{1,64}$/` consistent across Phase 1 (backend) ↔ Phase 2 (`renderIconHTML` guard) ↔ Phase 3 (sanitizer validation).
- `data-ic` attribute name consistent across all phases.
- `pix-note-ic` class name consistent.
- `<style id="pix-note-icon-css">` ID consistent in Phase 2 injection + Phase 2 manual verification.
- Function names — `ensureIcons` / `injectIconCSS` / `renderIconHTML` / `deriveLabel` / `openIconPop` / `_insertInlineIcon` — used consistently from definition (Phase 2) through wiring (Phase 4).
- Color hex `#f66744` consistent across backend (not stored, but matches spec), frontend default, CSS rules, and verification steps.

No inconsistencies.
