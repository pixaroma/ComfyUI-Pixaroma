# Note Pixaroma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `Note Pixaroma` ComfyUI custom node — a pure visual annotation widget with a professional WYSIWYG editor, link-only model downloads, and YouTube/Discord preset blocks.

**Architecture:** Purely client-side. A single hidden `note_json` STRING widget on the node holds `{version, content, accentColor, backgroundColor, width, height}` where `content` is sanitized HTML. An on-canvas DOM widget renders the HTML read-only; a hover-reveal "✏ Edit" button opens a fullscreen contenteditable editor. All HTML passes through a hand-written allowlist sanitizer before entering the DOM (on every save AND every load) — no external sanitization dependency. Mirrors the mixin/module pattern used by Paint, 3D, Composer, and Crop editors.

**Tech Stack:** Vanilla JS (ES modules, `.mjs` for non-entry), Python (ComfyUI custom-node mappings only), zero new dependencies. ComfyUI widget machinery: `node.addDOMWidget` for the body, `LiteGraph` hooks for double-click suppression.

**Spec:** [docs/superpowers/specs/2026-04-20-note-pixaroma-design.md](../specs/2026-04-20-note-pixaroma-design.md)

---

## Execution Environment

- **Branch:** Work directly on `Ioan` (already checked out). No worktree — per user preference, all changes must be served by the running ComfyUI instance from the main project dir.
- **Commits:** Local only. One commit per task for rollback safety. Never `git push` without explicit user request.
- **Git identity:** The repo has no configured user. Use the one-shot form for every commit:
  ```bash
  git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "..."
  ```
- **Manual verification:** This project has no test suite or linter (CLAUDE.md confirms). Each task ends with a **manual verification checklist** — the engineer must launch ComfyUI (or reload the browser tab pointed at the existing instance) and confirm the listed behavior with their own eyes before committing.
- **Reload between tasks:** ComfyUI serves `.js` files from `js/` at runtime. After changing JS, hard-refresh the browser (Ctrl+Shift+R). After changing Python (`__init__.py` or `nodes/node_note.py`), restart ComfyUI.

---

## File Structure

Files to be created/modified. Every file is under ~300 lines.

```
js/note/
├── index.js          # [NEW] Entry: ComfyUI extension, node lifecycle, DOM widget install
├── core.mjs          # [NEW] NoteEditor class shell (constructor, open/close/save, UI assembly)
├── toolbar.mjs       # [NEW] Toolbar construction + formatting commands (mixin on NoteEditor.prototype)
├── blocks.mjs        # [NEW] Pixaroma-block insert/edit dialogs (Download / YouTube / Discord)
├── render.mjs        # [NEW] On-canvas DOM widget factory: container, Edit button, placeholder, scroll, click delegation
├── sanitize.mjs      # [NEW] HTML allowlist sanitizer (pure function)
└── css.mjs           # [NEW] CSS string + injectCSS() (injected once)

nodes/
└── node_note.py      # [NEW] PixaromaNote class (same shape as node_label.py)

__init__.py           # [MODIFY] Import and merge note_node mappings
```

**No framework modifications.** `js/framework/` and `js/shared/` are reused read-only.

**No new backend routes.** All state lives in the workflow JSON.

---

## Task 1 — Python node stub + registration

**Files:**
- Create: `nodes/node_note.py`
- Modify: `__init__.py` (add import + merge mappings)

- [ ] **Step 1.1 — Create the Python node class**

Write `nodes/node_note.py`:
```python
class PixaromaNote:
    """Rich annotation note — pure UI node, no image processing."""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "note_json": (
                    "STRING",
                    {
                        "default": '{"version":1,"content":"","accentColor":"#f66744","backgroundColor":"transparent","width":420,"height":320}',
                        "multiline": True,
                    },
                ),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    OUTPUT_NODE = True
    CATEGORY = "Pixaroma"

    def noop(self, note_json):
        return {}


NODE_CLASS_MAPPINGS = {
    "PixaromaNote": PixaromaNote,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaNote": "Note Pixaroma",
}
```

- [ ] **Step 1.2 — Wire into `__init__.py`**

Open `__init__.py`. After the line importing `_MAPS_SHOW_TEXT` (around line 16), add:
```python
from .nodes.node_note import NODE_CLASS_MAPPINGS as _MAPS_NOTE
from .nodes.node_note import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_NOTE
```

In the `NODE_CLASS_MAPPINGS` dict (around line 28-37), add `**_MAPS_NOTE,` after `**_MAPS_LABEL,`.

In the `NODE_DISPLAY_NAME_MAPPINGS` dict (around line 40-49), add `**_NAMES_NOTE,` after `**_NAMES_LABEL,`.

- [ ] **Step 1.3 — Manual verify: node appears and instantiates**

Restart ComfyUI. Hard-refresh browser.

- Expected: Pixaroma banner prints `N nodes Loaded` with the count bumped by 1 vs. the previous run.
- In the ComfyUI node picker (right-click canvas → Add Node → Pixaroma, OR the new Vue picker), `Note Pixaroma` appears.
- Drag it onto the canvas. Node appears with title "Note Pixaroma", category "Pixaroma", a large multiline STRING widget visible (ugly JSON blob — that's fine, we hide it in Task 2).
- Save workflow → reload browser → workflow reloads, Note node still there, widget value preserved.
- No exceptions in the browser console or the ComfyUI terminal.

- [ ] **Step 1.4 — Commit**

```bash
git add nodes/node_note.py __init__.py
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): add PixaromaNote Python stub and registration"
```

---

## Task 2 — JS extension entry + hidden widget + node shell

Hides the raw JSON widget and sets up the lifecycle hooks, but doesn't render anything custom yet. After this task, the node shows a blank body (the default ComfyUI chrome with no visible widget).

**Files:**
- Create: `js/note/index.js`

- [ ] **Step 2.1 — Create `js/note/index.js`**

```js
import { app } from "/scripts/app.js";
import { hideJsonWidget, allow_debug } from "../shared/index.mjs";

const DEFAULT_CFG = {
  version: 1,
  content: "",
  accentColor: "#f66744",
  backgroundColor: "transparent",
  width: 420,
  height: 320,
};

function parseCfg(node) {
  const w = (node.widgets || []).find((x) => x.name === "note_json");
  if (!w?.value || w.value === "{}") return { ...DEFAULT_CFG };
  try {
    return { ...DEFAULT_CFG, ...JSON.parse(w.value) };
  } catch (e) {
    return { ...DEFAULT_CFG };
  }
}

function setupNote(node) {
  try {
    hideJsonWidget(node.widgets, "note_json");
    node._noteCfg = parseCfg(node);
    const cfg = node._noteCfg;
    if (node.size) {
      node.size[0] = cfg.width || 420;
      node.size[1] = cfg.height || 320;
    }
  } catch (err) {
    console.error("[Pixaroma Note] setupNote error:", err);
  }
}

app.registerExtension({
  name: "Pixaroma.Note",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaNote") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      setupNote(this);
      if (allow_debug) console.log("PixaromaNote created", this);
      return r;
    };

    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = _origCfg?.apply(this, arguments);
      setupNote(this);
      return r;
    };
  },
});
```

- [ ] **Step 2.2 — Manual verify: widget hidden, size applied**

Hard-refresh browser.

- Drag a new Note Pixaroma onto the canvas. The JSON text widget is NO LONGER visible; the node has a blank body area ~420×320 px.
- Save workflow → reload → node still at ~420×320 with hidden widget.
- Check browser console: no errors; if you set `allow_debug = true` in `js/shared/utils.mjs` temporarily, you see `"PixaromaNote created"` on create (revert after verifying).

- [ ] **Step 2.3 — Commit**

```bash
git add js/note/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): register JS extension and hide raw widget"
```

---

## Task 3 — CSS module + on-canvas DOM widget with placeholder

Adds the visible body: a scrollable container that displays saved HTML (empty for now) with a dim-italic placeholder when content is empty.

**Files:**
- Create: `js/note/css.mjs`
- Create: `js/note/render.mjs`
- Modify: `js/note/index.js`

- [ ] **Step 3.1 — Create `js/note/css.mjs`**

```js
import { BRAND } from "../shared/index.mjs";

let _injected = false;

export function injectCSS() {
  if (_injected) return;
  _injected = true;
  const s = document.createElement("style");
  s.setAttribute("data-pixaroma-note", "1");
  s.textContent = `
/* ── On-canvas node body ───────────────────────────────────── */
.pix-note-body {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: #e4e4e4;
  word-wrap: break-word;
  user-select: text;
}
.pix-note-body::-webkit-scrollbar { width: 6px; }
.pix-note-body::-webkit-scrollbar-track { background: transparent; }
.pix-note-body::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
.pix-note-body::-webkit-scrollbar-thumb:hover { background: ${BRAND}; }
.pix-note-body h1 { font-size: 20px; font-weight: 700; margin: 4px 0 8px; color: #fff; }
.pix-note-body h2 { font-size: 16px; font-weight: 700; margin: 10px 0 6px; color: #fff; }
.pix-note-body h3 { font-size: 14px; font-weight: 700; margin: 8px 0 4px; color: #fff; }
.pix-note-body p  { margin: 6px 0; }
.pix-note-body hr { border: none; border-top: 1px solid #333; margin: 10px 0; }
.pix-note-body ul, .pix-note-body ol { margin: 4px 0 4px 20px; padding: 0; }
.pix-note-body li { margin: 2px 0; }
.pix-note-body code {
  background: #2a2a2a; padding: 1px 5px; border-radius: 3px;
  font-family: "Consolas", "Courier New", monospace; font-size: 12px;
}
.pix-note-body pre {
  background: #1a1a1a; border: 1px solid #333; border-radius: 4px;
  padding: 8px 10px; overflow-x: auto; margin: 8px 0;
  font-family: "Consolas", "Courier New", monospace; font-size: 12px;
}
.pix-note-body pre code { background: transparent; padding: 0; }
.pix-note-body a { color: ${BRAND}; text-decoration: underline; cursor: pointer; }
.pix-note-body a:hover { text-decoration: none; }
.pix-note-body label { display: inline-flex; align-items: center; gap: 6px; cursor: default; }

/* Placeholder shown when content empty */
.pix-note-placeholder {
  color: #666; font-style: italic; pointer-events: none;
}

/* Pixaroma block: Download pill */
.pix-note-body .pix-note-dl {
  display: inline-block;
  padding: 5px 12px;
  margin: 2px 0;
  background: linear-gradient(180deg, var(--pix-note-accent, ${BRAND}), color-mix(in srgb, var(--pix-note-accent, ${BRAND}) 70%, black));
  color: #fff;
  border-radius: 5px;
  text-decoration: none !important;
  font-weight: 600;
  font-size: 12px;
  box-shadow: 0 2px 6px rgba(0,0,0,.3);
  cursor: pointer;
}
.pix-note-body .pix-note-dl:hover { filter: brightness(1.08); }

/* Pixaroma block: YouTube line */
.pix-note-body .pix-note-yt {
  color: #ff3838;
  font-weight: 600;
  text-decoration: underline;
}
.pix-note-body .pix-note-yt::before { content: "🎥 "; }

/* Pixaroma block: Discord line */
.pix-note-body .pix-note-discord {
  color: #5865f2;
  font-weight: 600;
  text-decoration: underline;
}
.pix-note-body .pix-note-discord::before { content: "💬 "; }

/* Hover-reveal Edit button */
.pix-note-editbtn {
  position: absolute;
  top: 6px; right: 10px;
  padding: 4px 10px;
  background: ${BRAND};
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 10;
  box-shadow: 0 2px 6px rgba(0,0,0,.4);
}
.pix-note-wrap:hover .pix-note-editbtn { opacity: 0.95; }
.pix-note-editbtn:hover { opacity: 1 !important; filter: brightness(1.1); }

.pix-note-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

/* Toast for clipboard feedback */
.pix-note-toast {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  background: #222;
  border: 1px solid ${BRAND};
  color: #fff;
  padding: 8px 14px;
  border-radius: 5px;
  font-size: 13px;
  z-index: 100000;
  box-shadow: 0 4px 14px rgba(0,0,0,.5);
  pointer-events: none;
  opacity: 0;
  transition: opacity 180ms ease;
}
.pix-note-toast.show { opacity: 1; }

  `;
  document.head.appendChild(s);
}
```

- [ ] **Step 3.2 — Create `js/note/render.mjs`**

```js
import { injectCSS } from "./css.mjs";

const PLACEHOLDER_TEXT = "Add your workflow notes here…";

export function createNoteDOMWidget(node) {
  injectCSS();
  const wrap = document.createElement("div");
  wrap.className = "pix-note-wrap";

  const body = document.createElement("div");
  body.className = "pix-note-body";
  wrap.appendChild(body);

  renderContent(node, body);
  return wrap;
}

export function renderContent(node, bodyEl) {
  const cfg = node._noteCfg || {};
  bodyEl.style.setProperty("--pix-note-accent", cfg.accentColor || "#f66744");
  bodyEl.style.background = cfg.backgroundColor && cfg.backgroundColor !== "transparent"
    ? cfg.backgroundColor : "transparent";

  const html = (cfg.content || "").trim();
  if (!html) {
    bodyEl.innerHTML = `<div class="pix-note-placeholder">${PLACEHOLDER_TEXT}</div>`;
    return;
  }
  // Sanitization is added in Task 5. For now, set innerHTML directly from
  // the trusted default (empty). This is safe because content is empty at
  // this point; Task 5 wraps this call with sanitize().
  bodyEl.innerHTML = html;
}
```

- [ ] **Step 3.3 — Wire `createNoteDOMWidget` into `index.js`**

Replace the entire contents of `js/note/index.js` with:
```js
import { app } from "/scripts/app.js";
import { hideJsonWidget, allow_debug } from "../shared/index.mjs";
import { createNoteDOMWidget, renderContent } from "./render.mjs";

const DEFAULT_CFG = {
  version: 1,
  content: "",
  accentColor: "#f66744",
  backgroundColor: "transparent",
  width: 420,
  height: 320,
};

function parseCfg(node) {
  const w = (node.widgets || []).find((x) => x.name === "note_json");
  if (!w?.value || w.value === "{}") return { ...DEFAULT_CFG };
  try {
    return { ...DEFAULT_CFG, ...JSON.parse(w.value) };
  } catch (e) {
    return { ...DEFAULT_CFG };
  }
}

function setupNote(node) {
  try {
    hideJsonWidget(node.widgets, "note_json");
    node._noteCfg = parseCfg(node);

    if (!node._noteDOMWrap) {
      const wrap = createNoteDOMWidget(node);
      node._noteDOMWrap = wrap;
      node._noteBody = wrap.querySelector(".pix-note-body");
      node.addDOMWidget("note_dom", "note", wrap, {
        serialize: false,
        getMinHeight: () => 80,
      });
    } else {
      renderContent(node, node._noteBody);
    }

    const cfg = node._noteCfg;
    if (node.size) {
      node.size[0] = cfg.width || 420;
      node.size[1] = cfg.height || 320;
    }
  } catch (err) {
    console.error("[Pixaroma Note] setupNote error:", err);
  }
}

app.registerExtension({
  name: "Pixaroma.Note",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaNote") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      setupNote(this);
      if (allow_debug) console.log("PixaromaNote created", this);
      return r;
    };

    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const r = _origCfg?.apply(this, arguments);
      setupNote(this);
      return r;
    };
  },
});
```

- [ ] **Step 3.4 — Manual verify: placeholder visible, body renders, scroll works**

Hard-refresh browser. Delete any existing Note nodes (their `_noteDOMWrap` is stale). Drag a new Note Pixaroma onto the canvas.

- Expected: The body shows `Add your workflow notes here…` in dim italic grey.
- Resize the node by dragging its bottom-right corner. The body resizes with it.
- Open DevTools Elements. Find the placeholder div. In Elements, inspect `.pix-note-body` → verify `color: #e4e4e4` on the wrapper, placeholder inside uses `color: #666 font-style: italic`.
- Temporary test: in DevTools Console, run:
  ```js
  const n = app.graph._nodes.find(x => x.type === "PixaromaNote");
  n._noteCfg.content = "<h1>Test Title</h1><p>Long paragraph. ".repeat(20) + "</p>";
  document.querySelector(".pix-note-body").innerHTML = n._noteCfg.content;
  ```
  The body should render with the heading and wrap text. If content exceeds height, vertical scrollbar appears.
- Remove that test content: reload the page.

- [ ] **Step 3.5 — Commit**

```bash
git add js/note/css.mjs js/note/render.mjs js/note/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): on-canvas DOM widget with placeholder and CSS"
```

---

## Task 4 — Hover-reveal Edit button + double-click suppression

Adds the visible "✏ Edit" button (hover-reveal), suppresses double-click so it can't accidentally open the editor, and wires a stub `openEditor()` that just console.logs for now.

**Files:**
- Modify: `js/note/render.mjs`
- Modify: `js/note/index.js`

- [ ] **Step 4.1 — Add Edit button to render.mjs**

At the top of `render.mjs`, after the `PLACEHOLDER_TEXT` constant, add:

```js
export function attachEditButton(wrap, onClick) {
  const btn = document.createElement("button");
  btn.className = "pix-note-editbtn";
  btn.type = "button";
  btn.innerHTML = "✏ Edit";
  btn.addEventListener("mousedown", (e) => {
    // Prevent LiteGraph from starting a node drag from the button
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  wrap.appendChild(btn);
  return btn;
}
```

- [ ] **Step 4.2 — Wire the button in `index.js` + suppress double-click**

In `js/note/index.js`, update the import line from render to include `attachEditButton`:
```js
import { createNoteDOMWidget, renderContent, attachEditButton } from "./render.mjs";
```

In `setupNote`, after `node._noteBody = wrap.querySelector(".pix-note-body");`, add:
```js
attachEditButton(wrap, () => openEditor(node));
```

Add a stub `openEditor` function above `setupNote`:
```js
function openEditor(node) {
  console.log("[Pixaroma Note] openEditor called — wiring in Task 6");
}
```

Inside `beforeRegisterNodeDef`, **after** the `onConfigure` override block, add:
```js
const _origDblClick = nodeType.prototype.onDblClick;
nodeType.prototype.onDblClick = function (e, pos) {
  // Intentional no-op: only the hover-reveal Edit button opens the editor.
  return false;
};
```

- [ ] **Step 4.3 — Manual verify: button hover behavior, double-click no-op**

Hard-refresh. Delete existing Note nodes. Drag a fresh Note onto the canvas.

- Expected: Move pointer OFF the node → no Edit button visible. Move pointer over the node body → orange "✏ Edit" button fades in at top-right. Move pointer away → fades out.
- Click the Edit button. DevTools Console logs `[Pixaroma Note] openEditor called — wiring in Task 6`. Node is NOT dragged.
- Double-click anywhere on the Note body. Nothing happens (no editor, no console error). Node is NOT dragged.
- Single-click the node background (not on the button). Node is selected normally. Can be dragged.

- [ ] **Step 4.4 — Commit**

```bash
git add js/note/render.mjs js/note/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): hover-reveal Edit button and double-click suppression"
```

---

## Task 5 — HTML allowlist sanitizer

Isolated, pure-function module. Takes untrusted HTML string, returns sanitized HTML string. Every future render path (on-canvas and preview) will pipe through this. Must land BEFORE any user-authored HTML is rendered.

**Files:**
- Create: `js/note/sanitize.mjs`
- Modify: `js/note/render.mjs`

- [ ] **Step 5.1 — Write the sanitizer**

Create `js/note/sanitize.mjs`:

```js
// Allowlist-based HTML sanitizer. No external dependencies.
// Input: arbitrary HTML string. Output: sanitized HTML string.
// Drops tags/attributes not on the allowlist. Forces target/rel on anchors.

const ALLOWED_TAGS = new Set([
  "h1","h2","h3","p","br","hr","ul","ol","li","b","i","u","s","strong","em",
  "code","pre","span","div","a","blockquote","label","input",
]);

// Pixaroma block classes are the ONLY allowed class values.
const ALLOWED_CLASS_VALUES = new Set([
  "pix-note-dl","pix-note-yt","pix-note-discord",
]);

// Inline-style properties we allow. Values are validated separately.
const ALLOWED_STYLE_PROPS = new Set([
  "color", "background-color", "text-align",
]);

// Color pattern: #abc, #aabbcc, rgb(), rgba(), or a narrow set of named colors.
const COLOR_RE = /^(#[0-9a-f]{3}([0-9a-f]{3})?|rgba?\([^)]+\)|transparent|inherit|currentColor|black|white|red|green|blue|yellow|orange|purple|gray|grey)$/i;
const ALIGN_RE = /^(left|right|center|justify)$/i;

const ALLOWED_HREF_PROTOCOLS = ["http:", "https:", "mailto:"];

// Per-tag attribute allowlist. "*" means "any tag".
const ALLOWED_ATTRS = {
  "*": new Set(["class", "style"]),
  a: new Set(["class","style","href","target","rel","data-folder","data-size","data-label"]),
  input: new Set(["type","checked","disabled"]),
  label: new Set(["class","style"]),
};

function filterClass(value) {
  if (typeof value !== "string") return "";
  return value
    .split(/\s+/)
    .filter((c) => ALLOWED_CLASS_VALUES.has(c))
    .join(" ");
}

function filterStyle(value) {
  if (typeof value !== "string") return "";
  const out = [];
  for (const chunk of value.split(";")) {
    const ix = chunk.indexOf(":");
    if (ix < 0) continue;
    const prop = chunk.slice(0, ix).trim().toLowerCase();
    const val = chunk.slice(ix + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if ((prop === "color" || prop === "background-color") && !COLOR_RE.test(val)) continue;
    if (prop === "text-align" && !ALIGN_RE.test(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join("; ");
}

function filterHref(value) {
  try {
    const u = new URL(value, "https://example.com/");
    if (!ALLOWED_HREF_PROTOCOLS.includes(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function filterElement(el) {
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    el.remove();
    return;
  }
  // input must be a checkbox only
  if (tag === "input") {
    const t = (el.getAttribute("type") || "").toLowerCase();
    if (t !== "checkbox") { el.remove(); return; }
  }

  // Scan attributes; mutate list while iterating via snapshot.
  const attrs = Array.from(el.attributes);
  const allowedForTag = ALLOWED_ATTRS[tag] || ALLOWED_ATTRS["*"];

  for (const a of attrs) {
    const name = a.name.toLowerCase();
    // Drop all event handlers unconditionally.
    if (name.startsWith("on")) { el.removeAttribute(a.name); continue; }
    if (!allowedForTag.has(name) && !ALLOWED_ATTRS["*"].has(name)) {
      el.removeAttribute(a.name);
      continue;
    }
    if (name === "class") {
      const cleaned = filterClass(a.value);
      if (cleaned) el.setAttribute("class", cleaned);
      else el.removeAttribute("class");
    } else if (name === "style") {
      const cleaned = filterStyle(a.value);
      if (cleaned) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
    } else if (name === "href") {
      const cleaned = filterHref(a.value);
      if (cleaned) el.setAttribute("href", cleaned);
      else el.remove();
    }
  }

  // All anchors: force safe target/rel
  if (tag === "a" && el.getAttribute("href")) {
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  }

  // Recurse into children (snapshot before removal)
  const kids = Array.from(el.children);
  for (const c of kids) filterElement(c);
}

export function sanitize(html) {
  if (typeof html !== "string" || html.length === 0) return "";
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${html}</body>`, "text/html"
  );
  const body = doc.body;
  // Walk top-level and descendants
  const topKids = Array.from(body.children);
  for (const c of topKids) filterElement(c);
  return body.innerHTML;
}
```

- [ ] **Step 5.2 — Wire sanitizer into `renderContent`**

Edit `js/note/render.mjs`. Add import at the top:
```js
import { sanitize } from "./sanitize.mjs";
```

Replace the `bodyEl.innerHTML = html;` line at the end of `renderContent` with:
```js
bodyEl.innerHTML = sanitize(html);
```

- [ ] **Step 5.3 — Manual verify: sanitizer strips malicious HTML**

Hard-refresh browser. In DevTools Console, run each of these and confirm expected behavior:

```js
// Helper to inject raw HTML into a Note node and re-render
function testSanitize(html) {
  const n = app.graph._nodes.find(x => x.type === "PixaromaNote");
  if (!n) { console.error("Drop a Note node first"); return; }
  n._noteCfg.content = html;
  const body = n._noteDOMWrap.querySelector(".pix-note-body");
  body.innerHTML = ""; // clear
  // Invoke the real render path
  import("/extensions/ComfyUI-Pixaroma/note/render.mjs").then(m => m.renderContent(n, body));
  console.log("body.innerHTML is now:", body.innerHTML);
}

// 1. script tag
testSanitize("<p>before</p><script>alert(1)</script><p>after</p>");
// Expected body.innerHTML: "<p>before</p><p>after</p>" (no script tag)

// 2. onerror attribute
testSanitize('<img src="x" onerror="alert(1)">');
// Expected: img is NOT in allowlist, removed entirely

// 3. javascript: URL
testSanitize('<a href="javascript:alert(1)">click</a>');
// Expected: anchor is REMOVED (href filter returns null → el.remove())

// 4. data: URL
testSanitize('<a href="data:text/html,<script>alert(1)</script>">click</a>');
// Expected: anchor removed

// 5. valid link: target+rel forced
testSanitize('<a href="https://pixaroma.com">OK</a>');
// Expected: <a href="https://pixaroma.com" target="_blank" rel="noopener noreferrer">OK</a>

// 6. class filter: only pix-note-* classes survive
testSanitize('<a class="evil pix-note-dl other" href="https://x.y">btn</a>');
// Expected: class="pix-note-dl" (evil and other dropped)

// 7. style filter: only color/background-color/text-align, with valid values
testSanitize('<p style="color:red; background-color:#fff; position:absolute; text-align:center">x</p>');
// Expected: style="color: red; background-color: #fff; text-align: center" (position dropped)

// 8. iframe dropped
testSanitize('<iframe src="https://evil.com"></iframe><p>ok</p>');
// Expected: only <p>ok</p>

// 9. nested malicious
testSanitize('<div><p>hi<span onclick="x()" style="expression(x)">y</span></p></div>');
// Expected: <div><p>hi<span>y</span></p></div> (onclick and expression dropped)

// 10. checkbox survives, but disabled input of other types does not
testSanitize('<label><input type="checkbox" checked disabled>task</label>');
// Expected: <label><input type="checkbox" checked="" disabled="">task</label>
```

Mark each vector as PASS in a notepad. If any FAIL, do NOT commit — fix the sanitizer and rerun.

- [ ] **Step 5.4 — Commit**

```bash
git add js/note/sanitize.mjs js/note/render.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): HTML allowlist sanitizer for XSS safety"
```

---

## Task 6 — Editor shell: overlay + header + footer + empty body

Creates the `NoteEditor` class with open/close/save lifecycle, matching Label Pixaroma's shell UX. Body is a single empty contenteditable for now; no toolbar yet. The Edit button now opens it.

**Files:**
- Create: `js/note/core.mjs`
- Modify: `js/note/css.mjs` (add editor shell CSS)
- Modify: `js/note/index.js` (wire `openEditor`)

- [ ] **Step 6.1 — Append editor shell CSS to `css.mjs`**

Inside the template string in `injectCSS()`, append (before the closing backtick):

```css
/* ── Editor overlay ───────────────────────────────────────── */
.pix-note-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.72);
  z-index: 99990; display: flex; align-items: center; justify-content: center;
  font-family: "Segoe UI", system-ui, sans-serif;
}
.pix-note-panel {
  background: #1b1b1b; border: 1px solid #333; border-radius: 8px;
  width: min(920px, 94vw); height: min(720px, 90vh);
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,.6);
}
.pix-note-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: #252525; border-bottom: 1px solid #333;
  color: #eee;
}
.pix-note-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; }
.pix-note-title-logo { width: 18px; height: 18px; }
.pix-note-title-brand { color: ${BRAND}; }
.pix-note-close {
  background: none; border: none; color: #aaa; font-size: 22px; cursor: pointer;
  width: 28px; height: 28px; line-height: 1; border-radius: 4px;
}
.pix-note-close:hover { background: #333; color: #fff; }

.pix-note-main {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.pix-note-editarea {
  flex: 1; overflow-y: auto; padding: 14px 18px; color: #e4e4e4; font-size: 13px;
  line-height: 1.55; background: #151515; outline: none;
}
.pix-note-editarea:focus-visible { outline: 1px solid ${BRAND}; outline-offset: -2px; }
.pix-note-editarea h1 { font-size: 22px; font-weight: 700; margin: 4px 0 8px; color: #fff; }
.pix-note-editarea h2 { font-size: 17px; font-weight: 700; margin: 10px 0 6px; color: #fff; }
.pix-note-editarea h3 { font-size: 15px; font-weight: 700; margin: 8px 0 4px; color: #fff; }
.pix-note-editarea hr { border:none; border-top: 1px solid #333; margin: 10px 0; }
.pix-note-editarea a  { color: ${BRAND}; text-decoration: underline; }
.pix-note-editarea code { background: #2a2a2a; padding: 1px 5px; border-radius: 3px; font-family: "Consolas", monospace; font-size: 12px; }
.pix-note-editarea pre  { background: #1a1a1a; border:1px solid #333; border-radius: 4px; padding: 8px 10px; font-family: "Consolas", monospace; font-size: 12px; }
.pix-note-editarea ul, .pix-note-editarea ol { margin: 4px 0 4px 20px; }

.pix-note-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 10px 14px; background: #202020; border-top: 1px solid #333;
}
.pix-note-btn {
  padding: 6px 14px; border-radius: 4px; font-size: 12px; font-weight: 600;
  border: 1px solid #333; background: #2a2a2a; color: #ddd; cursor: pointer;
}
.pix-note-btn:hover { background: #333; }
.pix-note-btn.primary { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
.pix-note-btn.primary:hover { filter: brightness(1.08); }
.pix-note-btn.ghost { background: transparent; }
```

- [ ] **Step 6.2 — Create `js/note/core.mjs`**

```js
import { app } from "/scripts/app.js";
import { BRAND, installFocusTrap } from "../shared/index.mjs";
import { injectCSS } from "./css.mjs";
import { sanitize } from "./sanitize.mjs";
import { renderContent } from "./render.mjs";

export class NoteEditor {
  constructor(node) {
    this.node = node;
    this.cfg = { ...(node._noteCfg || {}) };
    this._el = null;
    this._dirty = false;
  }

  open() {
    injectCSS();
    this._build();
    document.body.appendChild(this._el);
    installFocusTrap(this._el);
    this._keyBlock = (e) => e.stopImmediatePropagation();
    window.addEventListener("keydown", this._keyBlock, true);
    window.addEventListener("keyup", this._keyBlock, true);
    window.addEventListener("keypress", this._keyBlock, true);
    setTimeout(() => this._editArea?.focus(), 30);
  }

  close(force = false) {
    if (this._dirty && !force) {
      const ok = window.confirm("Unsaved changes will be lost. Close anyway?");
      if (!ok) return;
    }
    window.removeEventListener("keydown", this._keyBlock, true);
    window.removeEventListener("keyup", this._keyBlock, true);
    window.removeEventListener("keypress", this._keyBlock, true);
    if (this._el) { this._el.remove(); this._el = null; }
  }

  save() {
    const html = sanitize(this._editArea?.innerHTML || "");
    this.cfg.content = html;
    this.cfg.width = this.node.size?.[0] || this.cfg.width;
    this.cfg.height = this.node.size?.[1] || this.cfg.height;

    const w = (this.node.widgets || []).find((x) => x.name === "note_json");
    if (w) {
      const json = JSON.stringify(this.cfg);
      w.value = json;
      if (this.node.widgets_values) {
        const i = this.node.widgets.findIndex((x) => x.name === "note_json");
        if (i > -1) this.node.widgets_values[i] = json;
      }
      if (w.callback) w.callback(w.value);
    }
    this.node._noteCfg = this.cfg;

    const body =
      this.node._noteBody ||
      this.node._noteDOMWrap?.querySelector(".pix-note-body");
    if (body) renderContent(this.node, body);

    if (app.graph) {
      app.graph.setDirtyCanvas(true, true);
      if (typeof app.graph.change === "function") app.graph.change();
    }

    this._dirty = false;
    this.close(true);
  }

  _build() {
    const el = (tag, cls) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      return e;
    };

    const overlay = el("div", "pix-note-overlay");
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = el("div", "pix-note-panel");
    overlay.appendChild(panel);

    // Header
    const header = el("div", "pix-note-header");
    const titleSpan = el("div", "pix-note-title");
    const logo = document.createElement("img");
    logo.src = "/pixaroma/assets/pixaroma_logo.svg";
    logo.className = "pix-note-title-logo";
    titleSpan.appendChild(logo);
    titleSpan.append(" Note Editor ");
    const brandSpan = el("span", "pix-note-title-brand");
    brandSpan.textContent = "Pixaroma";
    titleSpan.appendChild(brandSpan);
    header.appendChild(titleSpan);

    const closeBtn = el("button", "pix-note-close");
    closeBtn.innerHTML = "\u00d7";
    closeBtn.onclick = () => this.close();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Main: (toolbar is added in Task 8)
    const main = el("div", "pix-note-main");
    panel.appendChild(main);

    // Toolbar placeholder — filled in by toolbar.mjs mixin
    this._toolbarEl = el("div", "pix-note-toolbar");
    main.appendChild(this._toolbarEl);

    // Edit area
    const editArea = el("div", "pix-note-editarea");
    editArea.contentEditable = "true";
    editArea.innerHTML = sanitize(this.cfg.content || "");
    editArea.addEventListener("input", () => { this._dirty = true; });
    main.appendChild(editArea);
    this._editArea = editArea;

    // Footer
    const footer = el("div", "pix-note-footer");
    const helpBtn = el("button", "pix-note-btn ghost");
    helpBtn.textContent = "? Help";
    helpBtn.onclick = () => this._showHelp(panel);
    const cancelBtn = el("button", "pix-note-btn");
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => this.close();
    const saveBtn = el("button", "pix-note-btn primary");
    saveBtn.textContent = "Save";
    saveBtn.onclick = () => this.save();
    footer.appendChild(helpBtn);
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    panel.appendChild(footer);

    this._el = overlay;
  }

  _showHelp(panel) {
    // Expanded in Task 20
    alert("Help panel — populated in Task 20.");
  }
}
```

- [ ] **Step 6.3 — Wire `openEditor` in `index.js`**

In `js/note/index.js`, replace the stub:
```js
function openEditor(node) {
  console.log("[Pixaroma Note] openEditor called — wiring in Task 6");
}
```
with a side-effect import + real opener. At the top of the file, add:
```js
import { NoteEditor } from "./core.mjs";
```
Then:
```js
function openEditor(node) {
  const editor = new NoteEditor(node);
  editor.open();
}
```

- [ ] **Step 6.4 — Manual verify: editor opens, closes, saves round-trip**

Hard-refresh. Drag a Note. Hover, click Edit.

- Expected: Fullscreen dim overlay appears. Panel is centered, with header ("Note Editor Pixaroma"), an empty area, empty toolbar strip, and footer (Help / Cancel / Save).
- Type into the edit area — text appears. (No formatting yet — plain text only.)
- Click Cancel → overlay closes, node on canvas still shows placeholder (nothing saved).
- Reopen. Type "Hello world". Click Save.
  - Overlay closes. Node body now shows "Hello world" as plain text (no placeholder).
- Save workflow → reload browser → reopen Note's editor via Edit button → "Hello world" is still there.
- Open editor again, type "more", click the × close button in the header → confirm dialog appears ("Unsaved changes will be lost. Close anyway?"). Click OK → editor closes, changes discarded.
- Repeat the dirty case with Esc key — confirm also fires. (Note: Esc handling added in Task 19.)

- [ ] **Step 6.5 — Commit**

```bash
git add js/note/core.mjs js/note/css.mjs js/note/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): editor overlay shell with save round-trip"
```

---

## Task 7 — Toolbar shell + text styles (B / I / U / S)

Adds the toolbar (visible bar at the top of the editor) and the first group of buttons (bold, italic, underline, strikethrough). Introduces `toolbar.mjs` as a mixin on `NoteEditor.prototype`.

**Files:**
- Create: `js/note/toolbar.mjs`
- Modify: `js/note/css.mjs` (add toolbar CSS)
- Modify: `js/note/core.mjs` (call `this._buildToolbar()`)
- Modify: `js/note/index.js` (side-effect import of toolbar.mjs)

- [ ] **Step 7.1 — Append toolbar CSS to `css.mjs`**

Inside `injectCSS()` template string, before the closing backtick, append:

```css
/* ── Toolbar ──────────────────────────────────────────────── */
.pix-note-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 3px;
  padding: 6px 8px; background: #202020; border-bottom: 1px solid #333;
}
.pix-note-tbtn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 26px; height: 26px; padding: 0 7px;
  background: #2a2a2a; border: 1px solid transparent; border-radius: 3px;
  color: #ddd; font-size: 12px; font-weight: 600; cursor: pointer;
  user-select: none;
}
.pix-note-tbtn:hover { background: #333; border-color: #444; }
.pix-note-tbtn.active { background: ${BRAND}; color: #fff; border-color: ${BRAND}; }
.pix-note-tbtn.italic { font-style: italic; font-family: Georgia, serif; }
.pix-note-tbtn.under { text-decoration: underline; }
.pix-note-tbtn.strike { text-decoration: line-through; }
.pix-note-tsep { width: 1px; height: 18px; background: #3a3a3a; margin: 0 4px; }
.pix-note-tgroup { display: inline-flex; gap: 3px; }
```

- [ ] **Step 7.2 — Create `js/note/toolbar.mjs`**

```js
import { NoteEditor } from "./core.mjs";

// Save and restore selection ranges so clicking a toolbar button doesn't
// blur the edit area and lose the user's text selection.
function saveRange(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  // Only persist selections that live inside our edit area
  if (!root.contains(r.commonAncestorContainer)) return null;
  return r.cloneRange();
}

function restoreRange(range) {
  if (!range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

NoteEditor.prototype._buildToolbar = function () {
  const tb = this._toolbarEl;
  tb.innerHTML = "";
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  const makeBtn = (label, title, cls, onClick) => {
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
    });
    return b;
  };

  // Group 1 — text style
  const g1 = el("div", "pix-note-tgroup");
  g1.appendChild(makeBtn("<b>B</b>", "Bold (Ctrl+B)", "", () =>
    document.execCommand("bold")));
  g1.appendChild(makeBtn("<i>I</i>", "Italic (Ctrl+I)", "italic", () =>
    document.execCommand("italic")));
  g1.appendChild(makeBtn("<span class='under'>U</span>", "Underline (Ctrl+U)", "", () =>
    document.execCommand("underline")));
  g1.appendChild(makeBtn("<span class='strike'>S</span>", "Strikethrough", "", () =>
    document.execCommand("strikeThrough")));
  tb.appendChild(g1);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Groups 2-7 added in later tasks.
  this._afterToolbarBuilt?.();
};
```

- [ ] **Step 7.3 — Call `_buildToolbar()` in `core.mjs`**

In `core.mjs`, inside `_build()`, after `main.appendChild(this._toolbarEl);`, add:
```js
this._buildToolbar();
```

- [ ] **Step 7.4 — Side-effect import toolbar in `index.js`**

At the top of `js/note/index.js`, add:
```js
import "./toolbar.mjs";  // side-effect: adds _buildToolbar to NoteEditor.prototype
```

- [ ] **Step 7.5 — Manual verify: B/I/U/S work on selected text**

Hard-refresh. Open Note editor.

- Expected: Toolbar strip visible at top of panel with four buttons (B, I, U, S), a vertical separator at the end.
- Type "hello world". Select "hello". Click B → "hello" becomes bold. Click B again → becomes normal. Same for I (italic), U (underline), S (strikethrough).
- Selection is preserved across button clicks (the word stays highlighted).
- Save → close → reopen → formatting is preserved in the editor AND on the canvas node face.

- [ ] **Step 7.6 — Commit**

```bash
git add js/note/toolbar.mjs js/note/css.mjs js/note/core.mjs js/note/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): toolbar shell with bold/italic/underline/strike"
```

---

## Task 8 — Toolbar: headings (H1 / H2 / H3)

**Files:**
- Modify: `js/note/toolbar.mjs` (append heading group)

- [ ] **Step 8.1 — Add heading buttons**

In `toolbar.mjs`, inside `_buildToolbar`, after `tb.appendChild(el("div", "pix-note-tsep"));` that follows Group 1, add:

```js
// Group 2 — headings
const g2 = el("div", "pix-note-tgroup");
const mkHeading = (tag, label) =>
  makeBtn(label, `Heading ${tag.toUpperCase()}`, "", () =>
    document.execCommand("formatBlock", false, tag)
  );
g2.appendChild(mkHeading("h1", "H1"));
g2.appendChild(mkHeading("h2", "H2"));
g2.appendChild(mkHeading("h3", "H3"));
// "Paragraph" resets heading
g2.appendChild(makeBtn("¶", "Paragraph (reset heading)", "", () =>
  document.execCommand("formatBlock", false, "p")
));
tb.appendChild(g2);
tb.appendChild(el("div", "pix-note-tsep"));
```

- [ ] **Step 8.2 — Manual verify: headings apply to current block**

Reload. Open editor. Type "my title", click H1 → line becomes large bold (22px). Click ¶ → reverts to paragraph. Same for H2 (17px), H3 (15px). Save → reload workflow → heading preserved in editor and on canvas. Canvas styling should match editor styling proportionally.

- [ ] **Step 8.3 — Commit**

```bash
git add js/note/toolbar.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): toolbar heading buttons H1/H2/H3 + paragraph reset"
```

---

## Task 9 — Toolbar: colors (text + highlight)

Swatch picker inline in the toolbar: 7 brand swatches + native color picker + hex input, for BOTH text color and background-color (highlight). Uses the Label Pixaroma swatch UX as reference.

**Files:**
- Modify: `js/note/toolbar.mjs` (append color group + popover)
- Modify: `js/note/css.mjs` (swatch popover styles)

- [ ] **Step 9.1 — Append color popover CSS to `css.mjs`**

Inside `injectCSS()` template string, append:

```css
/* Color popover */
.pix-note-colorpop {
  position: absolute; background: #222; border: 1px solid #444; border-radius: 5px;
  padding: 8px; z-index: 100000; display: flex; flex-direction: column; gap: 6px;
  box-shadow: 0 6px 18px rgba(0,0,0,.5);
}
.pix-note-swatches { display: grid; grid-template-columns: repeat(7, 18px); gap: 4px; }
.pix-note-swatch {
  width: 18px; height: 18px; border-radius: 3px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.1);
}
.pix-note-swatch.active { outline: 2px solid ${BRAND}; outline-offset: 1px; }
.pix-note-colorrow { display: flex; gap: 4px; align-items: center; }
.pix-note-colorrow input[type="color"] { width: 26px; height: 22px; padding: 0; border: 1px solid #444; border-radius: 3px; background: #1a1a1a; cursor: pointer; }
.pix-note-colorrow input[type="text"] {
  flex: 1; width: 80px; background: #1a1a1a; border: 1px solid #444;
  color: #ddd; padding: 3px 6px; font-size: 11px; font-family: "Consolas", monospace;
  border-radius: 3px;
}
.pix-note-colorrow .clearbtn {
  background: repeating-conic-gradient(#888 0 25%, #444 0 50%) 50%/8px 8px;
  width: 22px; height: 22px; border: 1px solid #444; border-radius: 3px; cursor: pointer;
}
```

- [ ] **Step 9.2 — Add color group + popover to `toolbar.mjs`**

In `toolbar.mjs`, after the heading group block, add:

```js
// Group 3 — colors
const SWATCHES = ["#f66744","#ffffff","#111111","#888888","#4a90e2","#5bd45b","#e25b5b"];

function openColorPop(anchorBtn, currentColor, onPick, allowClear = false) {
  const pop = document.createElement("div");
  pop.className = "pix-note-colorpop";
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.left = `${rect.left}px`;
  pop.style.top = `${rect.bottom + 4}px`;

  const sw = document.createElement("div");
  sw.className = "pix-note-swatches";
  SWATCHES.forEach((c) => {
    const s = document.createElement("div");
    s.className = "pix-note-swatch";
    s.style.background = c;
    if (c.toLowerCase() === (currentColor || "").toLowerCase()) s.classList.add("active");
    s.onclick = (e) => { e.stopPropagation(); onPick(c); close(); };
    sw.appendChild(s);
  });
  pop.appendChild(sw);

  const row = document.createElement("div");
  row.className = "pix-note-colorrow";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = /^#[0-9a-f]{6}$/i.test(currentColor || "") ? currentColor : "#f66744";
  picker.oninput = () => { onPick(picker.value); hex.value = picker.value; };
  const hex = document.createElement("input");
  hex.type = "text";
  hex.value = currentColor || "";
  hex.placeholder = "#rrggbb";
  hex.oninput = () => {
    const v = hex.value.startsWith("#") ? hex.value : `#${hex.value}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) { onPick(v); picker.value = v; }
  };
  row.appendChild(picker);
  row.appendChild(hex);
  if (allowClear) {
    const cl = document.createElement("div");
    cl.className = "clearbtn";
    cl.title = "Clear (transparent)";
    cl.onclick = (e) => { e.stopPropagation(); onPick(null); close(); };
    row.appendChild(cl);
  }
  pop.appendChild(row);

  document.body.appendChild(pop);

  const onDocClick = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorBtn) close();
  };
  function close() {
    document.removeEventListener("mousedown", onDocClick, true);
    pop.remove();
  }
  setTimeout(() => document.addEventListener("mousedown", onDocClick, true), 0);
}

const g3 = el("div", "pix-note-tgroup");

const textColorBtn = makeBtn("A", "Text color", "", () => {});
// Preempt default execCommand click: we open a popover instead.
textColorBtn.onclick = (e) => {
  e.preventDefault();
  const r = saveRange(this._editArea);
  openColorPop(textColorBtn, null, (c) => {
    this._editArea.focus();
    restoreRange(r);
    if (c == null) document.execCommand("removeFormat");
    else document.execCommand("foreColor", false, c);
    this._dirty = true;
  }, true);
};
textColorBtn.title = "Text color";
textColorBtn.style.fontWeight = "bold";
textColorBtn.style.borderBottom = `3px solid ${SWATCHES[0]}`;
g3.appendChild(textColorBtn);

const hiColorBtn = makeBtn("\u25A0", "Highlight color", "", () => {});
hiColorBtn.onclick = (e) => {
  e.preventDefault();
  const r = saveRange(this._editArea);
  openColorPop(hiColorBtn, null, (c) => {
    this._editArea.focus();
    restoreRange(r);
    // `hiliteColor` is the standard; Chrome supports it via execCommand.
    if (c == null) document.execCommand("hiliteColor", false, "transparent");
    else document.execCommand("hiliteColor", false, c);
    this._dirty = true;
  }, true);
};
g3.appendChild(hiColorBtn);

tb.appendChild(g3);
tb.appendChild(el("div", "pix-note-tsep"));
```

- [ ] **Step 9.3 — Manual verify: colors persist through sanitize**

Reload. Open editor. Type "hello". Select "hello" → click Text color (A) → pick orange swatch → "hello" turns orange. Click another swatch → color updates. Click the transparent/clear chip → color reset.

Same flow for highlight (■) with background color. Save → reload → colors preserved on canvas.

**Important sanitize check:** DevTools Console, after saving a colored note:
```js
const n = app.graph._nodes.find(x => x.type === "PixaromaNote");
console.log(n._noteCfg.content);
```
Confirm inline style values survive (e.g., `<span style="color: rgb(246, 103, 68)">hello</span>`). If `execCommand` produces a `<font color="...">` tag, the sanitizer will drop it (`<font>` not in allowlist) — in that case, note the issue, and fix by mapping foreColor output to `<span style="color:...">` manually. Most modern Chromium versions emit `<span>`.

- [ ] **Step 9.4 — Commit**

```bash
git add js/note/toolbar.mjs js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): text color and highlight swatches"
```

---

## Task 10 — Toolbar: lists (bullet / numbered / checkbox)

**Files:**
- Modify: `js/note/toolbar.mjs` (append list group)
- Modify: `js/note/css.mjs` (checkbox list styling)

- [ ] **Step 10.1 — Append list CSS to `css.mjs`**

```css
/* Checkbox list items (both editor and canvas) */
.pix-note-editarea label, .pix-note-body label {
  display: flex; align-items: center; gap: 6px; margin: 2px 0;
}
.pix-note-editarea label input[type="checkbox"] {
  accent-color: ${BRAND};
}
/* On-canvas checkboxes are non-interactive */
.pix-note-body label input[type="checkbox"] { pointer-events: none; }
```

- [ ] **Step 10.2 — Add list group to `toolbar.mjs`**

After Group 3 (colors) in `toolbar.mjs`, append:

```js
// Group 4 — lists
const g4 = el("div", "pix-note-tgroup");
g4.appendChild(makeBtn("&bull; List", "Bulleted list", "", () =>
  document.execCommand("insertUnorderedList")
));
g4.appendChild(makeBtn("1. List", "Numbered list", "", () =>
  document.execCommand("insertOrderedList")
));
g4.appendChild(makeBtn("☑", "Checkbox item", "", () => {
  // Insert a labeled checkbox at the current selection.
  const html = `<label><input type="checkbox"> </label>&nbsp;`;
  document.execCommand("insertHTML", false, html);
}));
tb.appendChild(g4);
tb.appendChild(el("div", "pix-note-tsep"));
```

- [ ] **Step 10.3 — Manual verify: lists insert, checkboxes render**

Reload. Open editor. Type a few lines, select them, click bullet list → lines bulletized. Click numbered list → numbered. Move caret to end of a line and click ☑ → checkbox appears. Tick it. Save → reload.

**On canvas:** checkboxes visible. Clicking them does nothing (per CSS `pointer-events: none`). Saved `checked` state persists across reloads (verified by reopening editor — checkbox is checked).

- [ ] **Step 10.4 — Commit**

```bash
git add js/note/toolbar.mjs js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): bullet / numbered / checkbox list buttons"
```

---

## Task 11 — Toolbar: link, inline code, code block, separator

**Files:**
- Modify: `js/note/toolbar.mjs` (append inserts group)

- [ ] **Step 11.1 — Add inserts group**

After Group 4 in `toolbar.mjs`, append:

```js
// Group 5 — inserts
const g5 = el("div", "pix-note-tgroup");

g5.appendChild(makeBtn("🔗", "Insert link", "", () => {
  const selText = window.getSelection()?.toString() || "";
  const url = window.prompt("URL (http/https):", "https://");
  if (!url) return;
  const safe = /^https?:\/\//i.test(url) || /^mailto:/i.test(url);
  if (!safe) { alert("Only http://, https://, and mailto: are allowed."); return; }
  const label = selText || url;
  document.execCommand(
    "insertHTML", false,
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
}));

g5.appendChild(makeBtn("{ }", "Inline code", "", () => {
  const sel = window.getSelection();
  const text = sel?.toString() || "code";
  document.execCommand("insertHTML", false, `<code>${text}</code>`);
}));

g5.appendChild(makeBtn("⟨/⟩", "Code block", "", () => {
  const sel = window.getSelection();
  const text = sel?.toString() || "// code";
  document.execCommand("insertHTML", false, `<pre><code>${text}</code></pre><p><br></p>`);
}));

g5.appendChild(makeBtn("—", "Horizontal separator", "", () => {
  document.execCommand("insertHTML", false, `<hr><p><br></p>`);
}));

tb.appendChild(g5);
tb.appendChild(el("div", "pix-note-tsep"));
```

- [ ] **Step 11.2 — Manual verify: inserts work**

Reload. Open editor.

- **Link:** type "click here", select "here", click 🔗, enter `https://pixaroma.com` → "here" becomes a clickable orange link. Save → reload → link preserved, opens in new tab, has `rel="noopener noreferrer"`.
- **Malicious link attempt:** click 🔗 without selection, enter `javascript:alert(1)` → an alert appears telling you only http/https/mailto are allowed. No link is inserted.
- **Inline code:** select a word, click `{ }` → word wrapped in code. On canvas it appears with monospace + grey background.
- **Code block:** click ⟨/⟩ with nothing selected → `// code` placeholder inserted as code block. Replace placeholder text by clicking in it.
- **Separator:** click — → horizontal rule inserted.
- Save, reload, confirm all four survive sanitization and render correctly.

- [ ] **Step 11.3 — Commit**

```bash
git add js/note/toolbar.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): link, inline code, code block, separator"
```

---

## Task 12 — Pixaroma block: Download button

Introduces `blocks.mjs` with the first of three Pixaroma blocks. The Download block is the most field-rich; YouTube and Discord in the next two tasks reuse the same dialog helper.

**Files:**
- Create: `js/note/blocks.mjs`
- Modify: `js/note/toolbar.mjs` (append inserts)
- Modify: `js/note/css.mjs` (block edit dialog styling)
- Modify: `js/note/render.mjs` (click delegation on canvas)
- Modify: `js/note/index.js` (side-effect import)

- [ ] **Step 12.1 — Append block-dialog CSS to `css.mjs`**

```css
/* ── Block edit dialog ───────────────────────────────────── */
.pix-note-blockdlg {
  position: fixed; background: #1b1b1b; border: 1px solid #444;
  border-radius: 6px; padding: 14px 16px; z-index: 100001;
  box-shadow: 0 10px 30px rgba(0,0,0,.6);
  min-width: 420px; max-width: 90vw;
  font-family: "Segoe UI", system-ui, sans-serif;
}
.pix-note-blockdlg h4 { margin: 0 0 10px; color: #fff; font-size: 14px; }
.pix-note-blockdlg .field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.pix-note-blockdlg label.lbl { font-size: 10.5px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
.pix-note-blockdlg input {
  background: #0f0f0f; border: 1px solid #333; border-radius: 3px;
  color: #ddd; font-size: 12px; padding: 5px 8px;
}
.pix-note-blockdlg input:focus { outline: 1px solid ${BRAND}; outline-offset: -1px; }
.pix-note-blockdlg .dlgfooter { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
```

- [ ] **Step 12.2 — Create `js/note/blocks.mjs`**

```js
import { NoteEditor } from "./core.mjs";

function makeDialog(anchorBtn, title, fields, onSubmit) {
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
    inp.value = defaultVal || "";
    if (placeholder) inp.placeholder = placeholder;
    row.appendChild(lbl);
    row.appendChild(inp);
    dlg.appendChild(row);
    inputs[key] = inp;
  }

  const footer = document.createElement("div");
  footer.className = "dlgfooter";
  const cancel = document.createElement("button");
  cancel.className = "pix-note-btn";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "pix-note-btn primary";
  ok.textContent = "Insert";
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
    onSubmit(values);
    close();
  };
  [...dlg.querySelectorAll("input")].forEach((i) =>
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); })
  );
}

NoteEditor.prototype._insertDownloadBlock = function (anchorBtn) {
  makeDialog(
    anchorBtn,
    "Insert download button",
    [
      ["label", "Label", "Model Name", "e.g. Flux 2 Model"],
      ["url", "Direct URL", "", "https://huggingface.co/..."],
      ["folder", "Suggested folder (for clipboard)", "models/diffusion_models", ""],
      ["size", "Size hint (optional)", "", "e.g. 9.4 GB"],
    ],
    (v) => {
      if (!v.url || !/^https?:\/\//i.test(v.url)) {
        alert("URL must start with http:// or https://");
        return;
      }
      const sizeStr = v.size ? ` (${escapeHtml(v.size)})` : "";
      const html = `<a class="pix-note-dl" href="${escapeHtml(v.url)}"` +
        ` data-folder="${escapeHtml(v.folder)}"` +
        (v.size ? ` data-size="${escapeHtml(v.size)}"` : "") +
        ` target="_blank" rel="noopener noreferrer">⬇ ${escapeHtml(v.label || "Download")}${sizeStr}</a>&nbsp;`;
      document.execCommand("insertHTML", false, html);
      this._dirty = true;
    }
  );
};

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 12.3 — Add Download button to toolbar**

In `toolbar.mjs`, after Group 5, add:

```js
// Group 6 — Pixaroma blocks
const g6 = el("div", "pix-note-tgroup");

const dlBtn = makeBtn("⬇ DL", "Insert download button", "", () => {});
dlBtn.onclick = (e) => {
  e.preventDefault();
  this._insertDownloadBlock(dlBtn);
};
g6.appendChild(dlBtn);

// YouTube and Discord buttons appended in Tasks 13 and 14.

tb.appendChild(g6);
```

- [ ] **Step 12.4 — Canvas click delegation in `render.mjs`**

Append to `render.mjs`:

```js
function showToast(msg) {
  const t = document.createElement("div");
  t.className = "pix-note-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 220);
  }, 1800);
}

export function attachCanvasClickDelegation(bodyEl) {
  bodyEl.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    // All anchors already have target=_blank from sanitizer, so the browser
    // opens the tab. We just need to do the clipboard+toast for download blocks.
    if (a.classList.contains("pix-note-dl")) {
      const folder = a.getAttribute("data-folder");
      if (folder && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(folder).then(
          () => showToast(`Path copied: ${folder}`),
          () => showToast("Path copy failed — see button's data-folder")
        );
      }
      // Let the browser navigate (target=_blank)
    }
    e.stopPropagation();
  }, true);
  bodyEl.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) e.stopPropagation();
  }, true);
}
```

Inside `createNoteDOMWidget`, after `wrap.appendChild(body);`, add:
```js
attachCanvasClickDelegation(body);
```

- [ ] **Step 12.5 — Side-effect import `blocks.mjs` in `index.js`**

```js
import "./blocks.mjs";
```

- [ ] **Step 12.6 — Manual verify: download block insert + canvas click + clipboard + toast**

Reload. Open editor.

- Click ⬇ DL → dialog opens with 4 fields. Fill Label=`Flux 2 Model`, URL=`https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors`, Folder=`models/diffusion_models/flux2`, Size=`23 GB`. Click Insert.
- An orange pill `⬇ Flux 2 Model (23 GB)` appears in the editor.
- Save. On the canvas, the same pill renders. Click it.
  - Expected: Opens the URL in a new tab.
  - Expected: A toast appears bottom-center: `Path copied: models/diffusion_models/flux2`. Check clipboard (paste into a text field) — contains that path.
- Attempt to insert with an empty URL — alert fires, no insert.
- Reload workflow — pill persists.

- [ ] **Step 12.7 — Commit**

```bash
git add js/note/blocks.mjs js/note/toolbar.mjs js/note/css.mjs js/note/render.mjs js/note/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): download button block with clipboard + toast"
```

---

## Task 13 — Pixaroma block: YouTube

**Files:**
- Modify: `js/note/blocks.mjs` (YouTube insert method)
- Modify: `js/note/toolbar.mjs` (YouTube button)

- [ ] **Step 13.1 — Add `_insertYouTubeBlock` to `blocks.mjs`**

Append to `blocks.mjs`:

```js
NoteEditor.prototype._insertYouTubeBlock = function (anchorBtn) {
  makeDialog(
    anchorBtn,
    "Insert YouTube link",
    [
      ["label", "Label", "Pixaroma YouTube Channel", ""],
      ["url", "URL", "https://www.youtube.com/@pixaroma", ""],
    ],
    (v) => {
      if (!v.url || !/^https?:\/\//i.test(v.url)) {
        alert("URL must start with http:// or https://");
        return;
      }
      const html = `<a class="pix-note-yt" href="${escapeHtml(v.url)}"` +
        ` target="_blank" rel="noopener noreferrer">${escapeHtml(v.label || "YouTube")}</a>&nbsp;`;
      document.execCommand("insertHTML", false, html);
      this._dirty = true;
    }
  );
};
```

- [ ] **Step 13.2 — Add YouTube toolbar button**

In `toolbar.mjs`, inside the Group 6 block (before `tb.appendChild(g6)`), append:

```js
const ytBtn = makeBtn("🎥 YT", "Insert YouTube link", "", () => {});
ytBtn.onclick = (e) => {
  e.preventDefault();
  this._insertYouTubeBlock(ytBtn);
};
g6.appendChild(ytBtn);
```

- [ ] **Step 13.3 — Manual verify: YouTube block works with default fill**

Reload. Open editor. Click `🎥 YT`. Dialog opens with label pre-filled to "Pixaroma YouTube Channel" and URL pre-filled. Click Insert directly.

- Expected: An underlined red link `🎥 Pixaroma YouTube Channel` appears (the 🎥 prefix is from CSS `::before`).
- Save → canvas shows the same. Click on canvas → opens YouTube channel in new tab, NO clipboard toast (because it's not a download block).

- [ ] **Step 13.4 — Commit**

```bash
git add js/note/blocks.mjs js/note/toolbar.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): YouTube preset block"
```

---

## Task 14 — Pixaroma block: Discord

**Files:**
- Modify: `js/note/blocks.mjs`
- Modify: `js/note/toolbar.mjs`

- [ ] **Step 14.1 — Add `_insertDiscordBlock`**

Append to `blocks.mjs`:

```js
NoteEditor.prototype._insertDiscordBlock = function (anchorBtn) {
  makeDialog(
    anchorBtn,
    "Insert Discord link",
    [
      ["label", "Label", "Join Here", ""],
      ["url", "URL", "https://discord.com/invite/gggpkVgBf3", ""],
    ],
    (v) => {
      if (!v.url || !/^https?:\/\//i.test(v.url)) {
        alert("URL must start with http:// or https://");
        return;
      }
      const html = `<a class="pix-note-discord" href="${escapeHtml(v.url)}"` +
        ` target="_blank" rel="noopener noreferrer">${escapeHtml(v.label || "Discord")}</a>&nbsp;`;
      document.execCommand("insertHTML", false, html);
      this._dirty = true;
    }
  );
};
```

- [ ] **Step 14.2 — Add Discord toolbar button**

In `toolbar.mjs`, inside Group 6 after the YouTube button:

```js
const dcBtn = makeBtn("💬 DC", "Insert Discord link", "", () => {});
dcBtn.onclick = (e) => {
  e.preventDefault();
  this._insertDiscordBlock(dcBtn);
};
g6.appendChild(dcBtn);
```

- [ ] **Step 14.3 — Manual verify: Discord block works with default**

Reload. Open editor. Click `💬 DC`. Dialog has label "Join Here" and URL pre-filled. Click Insert.

- Expected: An underlined blurple link `💬 Join Here`. Save → canvas renders it. Click → opens the Pixaroma Discord invite in new tab.

- [ ] **Step 14.4 — Commit**

```bash
git add js/note/blocks.mjs js/note/toolbar.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): Discord preset block"
```

---

## Task 15 — Code/Preview view toggle

Right-aligned segmented control in the toolbar that switches between WYSIWYG (the default) and a raw HTML code editor. Switching runs sanitize both directions so the user sees exactly what will be stored.

**Files:**
- Modify: `js/note/toolbar.mjs` (append toggle)
- Modify: `js/note/core.mjs` (code-view state, save path)
- Modify: `js/note/css.mjs` (toggle + code textarea styling)

- [ ] **Step 15.1 — Append toggle CSS to `css.mjs`**

```css
.pix-note-viewtoggle {
  margin-left: auto; display: inline-flex; background: #111;
  padding: 2px; border-radius: 4px; gap: 2px;
}
.pix-note-viewtoggle button {
  background: transparent; border: none; color: #888;
  padding: 3px 10px; font-size: 11px; font-weight: 600;
  border-radius: 3px; cursor: pointer;
}
.pix-note-viewtoggle button.active { background: ${BRAND}; color: #fff; }

.pix-note-codearea {
  flex: 1; background: #0d0d0d; color: #e0e0e0;
  font-family: "Consolas", "Courier New", monospace; font-size: 12.5px;
  padding: 12px 16px; border: none; outline: none;
  line-height: 1.5; resize: none; white-space: pre-wrap;
}
.pix-note-codearea:focus-visible { outline: 1px solid ${BRAND}; outline-offset: -2px; }
```

- [ ] **Step 15.2 — Add toggle to toolbar**

In `toolbar.mjs`, at the very end of `_buildToolbar` (after Group 6 append and before `this._afterToolbarBuilt?.();`), add:

```js
// View toggle
const tog = el("div", "pix-note-viewtoggle");
const codeBtn = document.createElement("button");
codeBtn.textContent = "Code";
const prevBtn = document.createElement("button");
prevBtn.textContent = "Preview";
prevBtn.classList.add("active");
tog.appendChild(codeBtn);
tog.appendChild(prevBtn);
tb.appendChild(tog);

const switchTo = (mode) => {
  if (mode === "code") {
    codeBtn.classList.add("active"); prevBtn.classList.remove("active");
    this._enterCodeView();
  } else {
    prevBtn.classList.add("active"); codeBtn.classList.remove("active");
    this._enterPreviewView();
  }
};
codeBtn.addEventListener("mousedown", (e) => e.preventDefault());
prevBtn.addEventListener("mousedown", (e) => e.preventDefault());
codeBtn.onclick = () => switchTo("code");
prevBtn.onclick = () => switchTo("preview");
```

- [ ] **Step 15.3 — Add view-switch methods to `core.mjs`**

Near the end of the `NoteEditor` class in `core.mjs`, add these methods:

```js
_enterCodeView() {
  if (this._mode === "code") return;
  const htmlNow = sanitize(this._editArea.innerHTML || "");
  // Hide editArea, show a textarea in its place
  this._editArea.style.display = "none";
  if (!this._codeArea) {
    const ta = document.createElement("textarea");
    ta.className = "pix-note-codearea";
    ta.spellcheck = false;
    ta.addEventListener("input", () => { this._dirty = true; });
    this._editArea.parentElement.appendChild(ta);
    this._codeArea = ta;
  }
  this._codeArea.style.display = "";
  this._codeArea.value = htmlNow;
  this._mode = "code";
  this._codeArea.focus();
}

_enterPreviewView() {
  if (this._mode !== "code") { this._mode = "preview"; return; }
  const raw = this._codeArea?.value || "";
  const clean = sanitize(raw);
  this._editArea.innerHTML = clean;
  this._codeArea.style.display = "none";
  this._editArea.style.display = "";
  this._mode = "preview";
  this._editArea.focus();
}
```

Also update the `save()` method. Replace:
```js
const html = sanitize(this._editArea?.innerHTML || "");
```
with:
```js
// If we're currently in code view, consume the textarea; otherwise the editArea
const raw = this._mode === "code"
  ? (this._codeArea?.value || "")
  : (this._editArea?.innerHTML || "");
const html = sanitize(raw);
```

And at the end of `_build()`, initialize `this._mode = "preview";`.

- [ ] **Step 15.4 — Manual verify: toggle round-trips, sanitizes both ways**

Reload. Open editor. Type some formatted content (a heading, a link, a download pill). Click `Code`.

- Expected: the area turns into a dark monospace textarea showing the raw HTML.
- Edit the HTML to add a malicious tag — e.g. append `<script>alert(1)</script>`. Click `Preview`.
  - Expected: the script tag is silently stripped. Legitimate content still renders.
- Click `Code` again — script tag is NOT present.
- Click Save. Reload workflow → content preserved without the script.

Edge case: Switch to Code → switch to Preview immediately without editing → nothing changes.

- [ ] **Step 15.5 — Commit**

```bash
git add js/note/toolbar.mjs js/note/core.mjs js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): Code/Preview view toggle with two-way sanitize"
```

---

## Task 16 — Resize persistence + confirm scroll overflow

The body already scrolls (via CSS). This task persists the node's size into the widget JSON on save and restores it on load.

**Files:**
- Modify: `js/note/index.js` (capture size on resize, write through `onResize`)

- [ ] **Step 16.1 — Capture size changes in `index.js`**

In `js/note/index.js`, inside `beforeRegisterNodeDef`, after the `onConfigure` block, add:

```js
const _origResize = nodeType.prototype.onResize;
nodeType.prototype.onResize = function (size) {
  const r = _origResize?.apply(this, arguments);
  // Persist size into cfg + widget so it survives reload.
  if (this._noteCfg) {
    this._noteCfg.width = Math.max(160, size[0]);
    this._noteCfg.height = Math.max(80, size[1]);
    const w = (this.widgets || []).find((x) => x.name === "note_json");
    if (w) w.value = JSON.stringify(this._noteCfg);
  }
  return r;
};
```

- [ ] **Step 16.2 — Manual verify: resize persists**

Reload. Drag a note onto canvas, put some content in it (via editor), resize it (drag corner). Save workflow. Reload browser. Confirm the node loads at the SAME size you resized to — not the default 420×320.

- Add a lot of content (paste a long article) → scrollbar appears inside the node body. Scroll works with mouse wheel and scrollbar.
- Reopen editor → edit area also scrolls for long content.

- [ ] **Step 16.3 — Commit**

```bash
git add js/note/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): persist resized node dimensions across reload"
```

---

## Task 17 — Per-note accent + background color (Settings area)

Expose the two cfg-level colors (`accentColor`, `backgroundColor`) in the editor so users can customize the Pixaroma-block accents and the node background per note.

**Files:**
- Modify: `js/note/core.mjs` (add a "Settings" row under the footer OR inside a small panel)
- Modify: `js/note/css.mjs` (settings row styling)

- [ ] **Step 17.1 — Append settings row CSS to `css.mjs`**

```css
.pix-note-settings {
  display: flex; align-items: center; gap: 14px;
  padding: 6px 14px; background: #1a1a1a; border-top: 1px solid #2a2a2a;
  font-size: 11px; color: #aaa;
}
.pix-note-settings .seg { display: flex; align-items: center; gap: 6px; }
.pix-note-settings input[type="color"] {
  width: 22px; height: 20px; padding: 0;
  border: 1px solid #333; border-radius: 3px; cursor: pointer; background: #0e0e0e;
}
.pix-note-settings .transbtn {
  background: repeating-conic-gradient(#888 0 25%, #444 0 50%) 50%/8px 8px;
  width: 20px; height: 20px; border: 1px solid #333; border-radius: 3px; cursor: pointer;
}
.pix-note-settings .transbtn.active { outline: 2px solid ${BRAND}; }
```

- [ ] **Step 17.2 — Render a settings row in `core.mjs`**

In `_build()`, AFTER `main.appendChild(editArea);` and BEFORE the footer is constructed, add:

```js
const settings = document.createElement("div");
settings.className = "pix-note-settings";

// Accent
const accSeg = document.createElement("div"); accSeg.className = "seg";
accSeg.innerHTML = `<span>Accent:</span>`;
const accPicker = document.createElement("input");
accPicker.type = "color";
accPicker.value = this.cfg.accentColor || "#f66744";
accPicker.addEventListener("input", () => {
  this.cfg.accentColor = accPicker.value;
  this._editArea.style.setProperty("--pix-note-accent", accPicker.value);
  this._dirty = true;
});
accSeg.appendChild(accPicker);
settings.appendChild(accSeg);

// Background
const bgSeg = document.createElement("div"); bgSeg.className = "seg";
bgSeg.innerHTML = `<span>Background:</span>`;
const bgPicker = document.createElement("input");
bgPicker.type = "color";
bgPicker.value = /^#[0-9a-f]{6}$/i.test(this.cfg.backgroundColor) ? this.cfg.backgroundColor : "#1b1b1b";
bgPicker.disabled = this.cfg.backgroundColor === "transparent";
bgPicker.addEventListener("input", () => {
  this.cfg.backgroundColor = bgPicker.value;
  this._editArea.style.background = bgPicker.value;
  transp.classList.remove("active");
  this._dirty = true;
});
const transp = document.createElement("div");
transp.className = "transbtn";
transp.title = "Transparent";
if (this.cfg.backgroundColor === "transparent") transp.classList.add("active");
transp.onclick = () => {
  this.cfg.backgroundColor = "transparent";
  this._editArea.style.background = "transparent";
  bgPicker.disabled = true;
  transp.classList.add("active");
  this._dirty = true;
};
bgSeg.appendChild(bgPicker);
bgSeg.appendChild(transp);
settings.appendChild(bgSeg);

// Apply initial accent to editArea's CSS var for live preview of accent in blocks
this._editArea.style.setProperty("--pix-note-accent", this.cfg.accentColor || "#f66744");
main.appendChild(settings);
```

- [ ] **Step 17.3 — Manual verify: accent drives Download pill, bg applies**

Reload. Open editor. Change Accent picker to blue.

- Expected: Any Download pill in the editor takes on the blue gradient (via CSS var `--pix-note-accent`). Click outside & reopen — still blue.
- Change Background picker to e.g. `#2a1b30`. Editor area background shifts to that purple. Click transparent chip — background returns to transparent.
- Save. Canvas node body shows the custom background (or transparent) and Download pills use the new accent.
- Reload workflow → both colors persist.

- [ ] **Step 17.4 — Commit**

```bash
git add js/note/core.mjs js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): per-note accent and background color pickers"
```

---

## Task 18 — Keyboard shortcuts + Ctrl+S + Esc dirty-confirm

Bind Ctrl+B/I/U to execCommands (even when the toolbar isn't focused), Ctrl+S to save, Esc to close (with dirty confirm already in place).

**Files:**
- Modify: `js/note/core.mjs` (`open()` adds a keydown listener)

- [ ] **Step 18.1 — Add keydown handler inside `open()`**

In `core.mjs` `open()`, after the three `window.addEventListener` calls for `_keyBlock`, add:

```js
this._keyHandler = (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "b") {
    e.preventDefault(); document.execCommand("bold"); this._dirty = true;
  } else if (mod && e.key.toLowerCase() === "i") {
    e.preventDefault(); document.execCommand("italic"); this._dirty = true;
  } else if (mod && e.key.toLowerCase() === "u") {
    e.preventDefault(); document.execCommand("underline"); this._dirty = true;
  } else if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault(); this.save();
  } else if (e.key === "Escape") {
    e.preventDefault(); this.close();
  }
};
this._el.addEventListener("keydown", this._keyHandler, true);
```

In `close()`, before the three `removeEventListener` calls, add:
```js
if (this._el && this._keyHandler) this._el.removeEventListener("keydown", this._keyHandler, true);
```

- [ ] **Step 18.2 — Manual verify: shortcuts work**

Reload. Open editor. Type "hello world", select "hello", press **Ctrl+B** → bolded. **Ctrl+I** → italic. **Ctrl+U** → underline.

- **Ctrl+S** → editor saves and closes. Content persisted on canvas. Workflow JSON updated.
- **Esc** with no unsaved changes → closes immediately. Esc with dirty edits → confirm prompt.
- Verify `keydown` handlers don't leak: close the editor, open it again, type — no doubled shortcut fires.

- [ ] **Step 18.3 — Commit**

```bash
git add js/note/core.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): keyboard shortcuts (Ctrl+B/I/U/S, Esc)"
```

---

## Task 19 — Help panel

Replaces the stub `alert(...)` with a proper inline help overlay, matching the pattern from Label.

**Files:**
- Modify: `js/note/core.mjs` (`_showHelp`)
- Modify: `js/note/css.mjs` (help styling)

- [ ] **Step 19.1 — Append help CSS**

```css
.pix-note-help {
  position: absolute; inset: 0; background: rgba(0,0,0,.82); z-index: 10;
  overflow-y: auto; padding: 24px 36px; color: #ddd; font-size: 13px;
}
.pix-note-help h3 { color: #fff; margin: 0 0 8px; }
.pix-note-help p { margin: 4px 0; line-height: 1.6; }
.pix-note-help b { color: #fff; }
.pix-note-help a { color: ${BRAND}; }
.pix-note-help-close {
  position: absolute; top: 10px; right: 14px; background: none;
  color: #aaa; border: none; font-size: 22px; cursor: pointer;
}
.pix-note-help-close:hover { color: #fff; }
```

- [ ] **Step 19.2 — Replace `_showHelp` in `core.mjs`**

Replace the placeholder body with:

```js
_showHelp(panel) {
  if (panel.querySelector(".pix-note-help")) return;
  const h = document.createElement("div");
  h.className = "pix-note-help";
  h.innerHTML = `
    <h3>Note Pixaroma</h3>
    <p><b>Purpose:</b> Annotate your workflow with rich formatted notes — models to download, nodes used, tutorials. Pure visual; not wired into processing.</p>
    <p><b>Text:</b> Bold (Ctrl+B), Italic (Ctrl+I), Underline (Ctrl+U), Strikethrough.</p>
    <p><b>Headings:</b> H1 / H2 / H3 apply to the current line. ¶ resets to paragraph.</p>
    <p><b>Colors:</b> A changes text color. ■ changes highlight. Clear chip removes color.</p>
    <p><b>Lists:</b> bullet, numbered, and ☑ checkboxes. Checkboxes are interactive in the editor; non-interactive on the canvas.</p>
    <p><b>Inserts:</b> 🔗 link (http/https/mailto only), { } inline code, ⟨/⟩ code block, — horizontal separator.</p>
    <p><b>⬇ Download:</b> inserts a pill button. Click on the canvas opens the URL in a new tab and copies the target folder path to your clipboard — paste it into your browser's Save As dialog.</p>
    <p><b>🎥 YouTube / 💬 Discord:</b> preset Pixaroma links. Click to insert; defaults are the Pixaroma channels. Override if you like.</p>
    <p><b>Code / Preview:</b> Toggle at the top-right. Code view shows raw sanitized HTML; Preview is WYSIWYG.</p>
    <p><b>Security:</b> any &lt;script&gt;, event handler, or javascript: URL you paste is stripped automatically.</p>
    <p><b>Save:</b> Ctrl+S or the Save button. Esc prompts if you have unsaved changes.</p>
    <p style="margin-top:14px;color:#888">Pixaroma &mdash; <a href="https://www.youtube.com/@pixaroma">youtube.com/@pixaroma</a></p>
  `;
  const close = document.createElement("button");
  close.className = "pix-note-help-close";
  close.innerHTML = "\u00d7";
  close.onclick = () => h.remove();
  h.appendChild(close);
  panel.appendChild(h);
}
```

Also add `position: relative;` to `.pix-note-panel` in CSS if it isn't already there (so the absolutely-positioned help overlay scopes correctly). Check Step 6.1 — it should already be a flex container; add `position: relative;`:

Update the `.pix-note-panel` rule in `css.mjs`:
```css
.pix-note-panel {
  background: #1b1b1b; border: 1px solid #333; border-radius: 8px;
  width: min(920px, 94vw); height: min(720px, 90vh);
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,.6);
  position: relative;    /* <-- ADDED */
}
```

- [ ] **Step 19.3 — Manual verify: help opens/closes, covers panel**

Reload. Open editor. Click `? Help` in footer. Overlay appears inside the panel, covering the entire area. Click × on help → overlay closes. Editor usable again.

- [ ] **Step 19.4 — Commit**

```bash
git add js/note/core.mjs js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): help panel with full feature reference"
```

---

## Task 20 — Verification pass (functional + security + Vue)

Runs the full checklist from the design spec. Documents results. No code changes unless a check fails; failures should trigger back-tracking to the appropriate task.

**Files:** none (verification only)

- [ ] **Step 20.1 — Functional checklist**

Work through every item. Mark PASS or note failure.

1. New Note node → placeholder visible → hover → Edit button appears → click Edit → editor opens.
2. Toolbar groups render in order: Text / Headings / Colors / Lists / Inserts / Pixaroma / View toggle.
3. Each of the 4 text-style buttons toggles formatting on selected text.
4. Each of the 3 heading buttons + ¶ produce expected block tags.
5. Text color swatch picker + hex + clear: each produces inline style, persists through sanitize.
6. Highlight color: same.
7. Bullet / Numbered lists format selected lines.
8. Checkbox item inserts a working checkbox (editable in editor, non-interactive on canvas).
9. Link inserter rejects `javascript:` and `data:` URLs with alert.
10. Inline code, code block, horizontal separator all insert correctly.
11. Download block dialog validates URL protocol; inserts pill with accent color; clicking pill on canvas opens tab + copies folder path + shows toast.
12. YouTube block dialog has Pixaroma defaults prefilled; renders as a red underlined link on canvas; click opens the channel.
13. Discord block dialog has Pixaroma defaults prefilled; renders as blurple underlined link; click opens invite.
14. Code/Preview toggle: switching back preserves content, two-way sanitize runs.
15. Resize the node → dimensions persist through workflow save/reload.
16. Accent color picker changes Download pill color live; persists.
17. Background color picker + transparent chip; persists.
18. Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+S / Esc all work as described.
19. Help panel opens and closes.
20. Double-click on Note body does nothing. No right-click "Edit" item.

- [ ] **Step 20.2 — Security checklist**

Using the `testSanitize()` helper from Task 5.3 (or by pasting directly into Code view and clicking Preview, then saving and reopening):

1. Paste `<script>alert(1)</script>` into Code view → save → reload → no alert, script missing from saved content.
2. `<img src=x onerror=alert(1)>` → img stripped entirely.
3. `<a href="javascript:alert(1)">x</a>` → anchor stripped.
4. `<iframe src="https://evil.com">` → iframe stripped.
5. Every saved `<a>` tag in the raw JSON has `rel="noopener noreferrer"` and `target="_blank"`.
6. Paste a long ChatGPT-formatted markdown response with headings, bold, bullets, code blocks — all legitimate content survives.

- [ ] **Step 20.3 — Vue frontend compatibility checklist**

1. Edit + save a note with Vue frontend enabled (ComfyUI setting).
2. Close editor overlay → switch workflow tabs → switch back → reopen editor → content intact.
3. Delete the Note while the editor is open → editor closes cleanly without errors in console.
4. Verify `node._noteDOMWrap` and `node._noteBody` don't become dangling references — use the `overlay.isConnected` pattern if needed (per CLAUDE.md §Vue #2).

- [ ] **Step 20.4 — Commit verification notes (if any fixes were needed)**

If Step 20.1–20.3 uncovered issues that required fixes, each fix has its own commit. No additional commit for the verification pass itself (the commit history already reflects what was changed).

If all passed without changes, create a no-op marker commit:
```bash
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit --allow-empty -m "test(note): manual verification pass — all checks green"
```

- [ ] **Step 20.5 — Final DONE signal**

Print to the user:
```
============================================
DONE — Note Pixaroma implementation complete
============================================
```
(Per the user's memory preference: print a big DONE so they know when to test.)

---

## Rollback Plan

Every task ends with a committed rollback point. To revert:
- `git log --oneline` on `Ioan` shows the task sequence.
- `git reset --hard <sha>` rolls back to any completed task.
- Nothing is pushed, so rollbacks have zero effect on collaborators.

## Self-Review (run by plan author)

**Spec coverage:**
- §1 Overview → Task 1, 2.
- §2.1 On-canvas UX → Tasks 3, 4, 16.
- §2.2 Editor popup shell + toolbar layout → Tasks 6, 7 through 11, 15.
- §3 Pixaroma blocks → Tasks 12, 13, 14.
- §4 Content model + schema + save/load flow → Tasks 1, 3, 6, 15, 16, 17.
- §5 File layout + mixin pattern + Vue compat → all tasks touch matching files; Vue compat verified in Task 20.3.
- §6 Security / sanitizer → Task 5, verified in 20.2; also hit on every save path in Tasks 6, 15.
- §7 Out of scope → none needed in plan (correctly absent).
- §8 Testing strategy → Task 20 materializes the checklist.

**Placeholder scan:** No "TBD", "TODO", "implement later", "add appropriate error handling" phrases. Every code step has actual code. Every verification step names the concrete expected behavior.

**Type/name consistency:**
- `node._noteCfg`, `node._noteDOMWrap`, `node._noteBody` used consistently across Tasks 3, 4, 6, 7, 15, 16, 17.
- `NoteEditor` class referenced consistently; `_editArea`, `_codeArea`, `_mode`, `_dirty`, `_keyBlock`, `_keyHandler`, `_toolbarEl` all defined before use.
- Widget name `note_json` matches between Python (Task 1) and JS (Task 2 parseCfg, Task 6 save).
- Class strings `pix-note-dl`, `pix-note-yt`, `pix-note-discord` used consistently in sanitizer allowlist (Task 5), block inserts (Tasks 12–14), and CSS (Tasks 3, 10).
- `sanitize()` export signature is stable (string → string) across callers in Task 3, 6, 15.

All green. Plan ready for execution.
