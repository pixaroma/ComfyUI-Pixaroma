# Pixaroma Editor — AI Agent Development Guide

> **Source of truth:** `web/js/pixaroma_base_editor.js`
> This file owns the shell, header, backdrop, CSS variables, and all base classes.
> Never duplicate or override what the base already provides.

---

## 1. Architecture — Template Method Pattern

Every editor is a class that **extends `PixaromaEditorBase`**.
The base class builds the full UI shell and calls hook methods that subclasses override.

```
PixaromaEditorBase  (pixaroma_base_editor.js)
  ├── CropEditor        (pixaroma_crop_core.js)
  ├── Pixaroma3DEditor  (pixaroma_3d_core.js)
  ├── PaintStudio       (pixaroma_paint_core.js)
  └── PixaromaEditor    (pixaroma_composer_core.js)
```

**What the base owns (do not reimplement):**
- Backdrop scrim `.pxb-backdrop`
- Floating overlay container `.pxb-overlay`
- Titlebar with logo, title, separator, Save button, Close button
- `open()` / `_close()` lifecycle and focus trap
- All `--pxb-*` CSS variables

---

## 2. Creating a New Editor

```js
import { PixaromaEditorBase } from "./pixaroma_base_editor.js";

export class MyEditor extends PixaromaEditorBase {
  constructor() {
    super();
    // editor-specific state only
  }
}

// To open:
const editor = new MyEditor();
editor.open(jsonString);   // base handles DOM + backdrop + focus trap

// External close callback (optional):
editor.onClose = () => { /* notify ComfyUI node */ };
```

---

## 3. Hook Methods Reference

Override only the hooks you need. All return `null` / empty `div` by default.

| Hook | Return type | Purpose |
|---|---|---|
| `_editorTitle()` | HTML string | Text shown next to logo in titlebar |
| `_buildTitlebarActions()` | Element \| null | Undo/Redo/Help buttons in header |
| `_buildTopBar()` | Element \| null | Bar between titlebar and body |
| `_buildLeftSidebar()` | Element \| null | Left tools/settings panel |
| `_buildWorkspace()` | Element | Canvas or main interactive area |
| `_buildRightSidebar()` | Element \| null | Right layers/properties panel |
| `_buildHelpStrip()` | Element \| null | Keyboard hint strip at bottom |
| `_buildBottomBar()` | Element \| null | Status/footer bar |
| `_onOpen(jsonStr)` | void | Post-mount init (parse data, bind events) |
| `_save()` | void | Called by header Save button |
| `_close()` | void | Override to add cleanup, always call `super._close()` |

### Title example
```js
_editorTitle() {
  return `My Tool <span class="pxb-brand">Pixaroma</span>`;
}
```

### Titlebar actions example (Undo / Redo)
```js
_buildTitlebarActions() {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;gap:4px;align-items:center;";
  this.undoBtn = document.createElement("button");
  this.undoBtn.className = "pxb-hdr-btn";    // ← always pxb-hdr-btn
  this.undoBtn.textContent = "↩ Undo";
  this.undoBtn.onclick = () => this.undo();
  wrap.appendChild(this.undoBtn);
  return wrap;
}
```

### Save hook example (delegate to internal button)
```js
_save() {
  // If complex async save logic is on an internal button, forward the click:
  if (this.saveBtn) this.saveBtn.click();
}
```

### Close override example
```js
_close() {
  this._unbindKeys();      // editor-specific cleanup
  super._close();          // base removes backdrop + overlay
}
```

---

## 4. CSS Classes & Variables

### CSS Variables (defined in base, use everywhere)
```css
--pxb-brand          #f66744   /* orange accent */
--pxb-bg             #1a1b1d   /* editor background */
--pxb-bg-bar         #131415   /* titlebar / footer background */
--pxb-bg-sidebar     #181a1b   /* sidebar background */
--pxb-border         #2e3033   /* outer borders */
--pxb-border-inner   #2a2c2e   /* inner dividers */
--pxb-text           #e0e0e0   /* body text */
--pxb-titlebar-h     44px      /* titlebar height */
--pxb-radius         12px      /* editor corner radius */
--pxb-gap            24px      /* gap between editor and viewport edge */
```

### Base CSS Classes (do not redefine)
| Class | Purpose |
|---|---|
| `.pxb-overlay` | The floating editor container |
| `.pxb-backdrop` | Blurred scrim behind the editor |
| `.pxb-titlebar` | The header bar |
| `.pxb-title` | Logo + editor title area |
| `.pxb-brand` | Orange brand color span |
| `.pxb-titlebar-actions` | Wrapper for hook-provided actions |
| `.pxb-hdr-sep` | Vertical separator in titlebar |
| `.pxb-hdr-btn` | **Unified header action button** (Undo/Redo/Help) |
| `.pxb-save-btn` | Orange Save button (auto-injected by base) |
| `.pxb-close-btn` | Red-hover Close button (auto-injected by base) |
| `.pxb-body` | The main flex row (left + workspace + right) |
| `.pxb-topbar` | Optional bar above body |
| `.pxb-help-strip` | Keyboard hint strip |
| `.pxb-bottombar` | Footer / status bar |

### Editor-private CSS
Each editor injects its own `<style>` tag in `_onOpen()` using its own prefix (e.g., `ppx-`, `pcrop-`, `p3d-`). This is correct — only **shell-level** elements must use `pxb-` classes.

---

## 5. Rules — Must Follow

1. **Always extend `PixaromaEditorBase`.** Never build an editor as a standalone overlay.
2. **Never call `document.body.appendChild(overlay)` directly.** Use `this.open()`.
3. **Never call `installFocusTrap()` in a subclass.** The base handles it.
4. **Never hardcode `#f66744` in subclass code.** Use `var(--pxb-brand)` in CSS or `BRAND` from `pixaroma_shared.js` in JS.
5. **Always use `pxb-hdr-btn` for buttons placed in `_buildTitlebarActions`.** Never use editor-private button classes (`ppx-btn`, `pcrop-btn`, `pix-view-btn`) in the titlebar — they will clash visually.
6. **Never add a second close or save button manually.** The base injects them. Override `_save()` and `_close()` instead.
7. **Always call `super._close()` at the end of a `_close()` override.** Skipping it will leak the backdrop and overlay in the DOM.
8. **The `this.el` object is shared.** Store all DOM references your editor creates as `this.el.myThing` to keep them discoverable.
9. **Do not modify `_buildUI()` or `open()` in subclasses.** They are sealed by the base. Use hooks.
10. **`_onOpen(jsonStr)` is the only place to start async work.** The DOM is fully mounted when it fires.

---

## 6. Dos and Don'ts — Quick Reference

| ✅ Do | ❌ Don't |
|---|---|
| `this.el.undoBtn.className = "pxb-hdr-btn"` | `this.el.undoBtn.className = "ppx-btn"` in titlebar |
| `_close() { cleanup(); super._close(); }` | `document.body.removeChild(this.overlay)` |
| `_save() { this.internalSaveBtn.click(); }` | Duplicate the save async logic |
| `var(--pxb-brand)` | `#f66744` hardcoded in CSS |
| Inject editor CSS in `_onOpen()` | Inject it in the constructor or before `open()` |
| Use `this.el.headerSaveBtn` to reflect save state | Add a second save button to the DOM |

---

## 7. Existing Editor Summary

| Editor | File | Extra hooks used |
|---|---|---|
| Image Composer | `pixaroma_composer_core.js` | `_buildTitlebarActions` (Undo/Redo/Help), all sidebars |
| Paint Studio | `pixaroma_paint_core.js` | `_buildTitlebarActions` (Undo/Redo), `_buildTopBar`, `_buildHelpStrip`, `_buildBottomBar` |
| 3D Builder | `pixaroma_3d_core.js` | Both sidebars, no titlebar actions |
| Image Crop | `pixaroma_crop_core.js` | `_buildWorkspace`, `_buildBottomBar`, no titlebar actions |

