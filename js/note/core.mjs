import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";
import { injectCSS } from "./css.mjs";
import { sanitize } from "./sanitize.mjs";
import { buildCodeViewDOM } from "./codeview.mjs";
import { renderContent } from "./render.mjs";

export class NoteEditor {
  constructor(node) {
    this.node = node;
    this.cfg = { ...(node._noteCfg || {}) };
    this._el = null;
    this._dirty = false;
  }

  open() {
    // Preload inline-icon list + inject per-icon CSS rules so the toolbar
    // picker opens instantly without a round-trip fetch. Both calls are
    // idempotent (cache + one-time injection guards). Fire-and-forget —
    // we never block editor open on the fetch.
    //
    // NOTE: dynamic import() is deliberate, NOT laziness. `icons.mjs`
    // attaches prototype methods to NoteEditor at module-top (Phase 4).
    // A static `import { ... } from "./icons.mjs"` here would create a
    // circular dependency — core.mjs imports icons.mjs statically, but
    // icons.mjs imports NoteEditor from core.mjs — and when icons.mjs
    // first evaluates, NoteEditor would be undefined, crashing the
    // prototype extension. Dynamic import() defers loading until after
    // the class is fully defined. DO NOT simplify to a static import.
    import("./icons.mjs").then((m) => {
      m.ensureIcons().then(() => m.injectIconCSS());
    });
    injectCSS();
    this._build();
    document.body.appendChild(this._el);
    // Don't use installFocusTrap here — its mouseup refocus pulls focus
    // away from the contenteditable on any button click (breaking typing)
    // and wipes the text selection on drag-select that ends outside the
    // panel. Ctrl+Z escape is handled by the capture listeners + graph
    // undo neutering below.
    // Intercept Ctrl/Cmd+Z/Y explicitly — if the event escapes to ComfyUI's
    // shortcut handlers the graph's undo runs, which removes the node that
    // owns this editor. We run the contenteditable's native undo/redo
    // ourselves so in-editor typing history still works.
    this._keyBlock = (e) => {
      const key = (e.key || "").toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      // Undo / Redo → our manual history (covers direct-DOM toolbar mutations
      // that the browser's contenteditable undo doesn't track).
      if (mod && (key === "z" || key === "y")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.type === "keydown") {
          const isRedo = key === "y" || (key === "z" && e.shiftKey);
          if (this._editArea && document.activeElement !== this._editArea) {
            this._editArea.focus();
          }
          try { if (isRedo) this.doRedo(); else this.doUndo(); } catch (err) {}
        }
        return;
      }
      // Editor-scoped shortcuts. Only on keydown — keyup/keypress still need
      // to be blocked so ComfyUI doesn't see them.
      if (e.type === "keydown") {
        // Bold / Italic / Underline — browser does this natively in a
        // contenteditable, but we handle it explicitly so (a) ComfyUI can't
        // see the key (its shortcuts are suppressed), and (b) the dirty flag
        // + manual-history debounce are updated reliably.
        if (mod && (key === "b" || key === "i" || key === "u")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (this._editArea && document.activeElement !== this._editArea) {
            this._editArea.focus();
          }
          const cmd = key === "b" ? "bold" : key === "i" ? "italic" : "underline";
          try { document.execCommand(cmd); } catch (err) {}
          this._dirty = true;
          return;
        }
        // Ctrl/Cmd+S → save.
        if (mod && key === "s") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.save();
          return;
        }
        // Tab inside a table cell: move caret to next/previous cell.
        // Swallow unconditionally when inside a cell so Tab doesn't
        // escape to ComfyUI's workflow-tab shortcut or to the next
        // focusable element.
        if (key === "tab") {
          const sel = window.getSelection();
          const anchor = sel?.anchorNode;
          let cell = null;
          let n = anchor;
          while (n && n !== this._editArea) {
            if (n.nodeType === 1 && (n.tagName === "TD" || n.tagName === "TH")) {
              cell = n;
              break;
            }
            n = n.parentNode;
          }
          if (cell) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const cells = Array.from(
              cell.closest("table").querySelectorAll("th, td")
            );
            const ix = cells.indexOf(cell);
            const next = e.shiftKey ? cells[ix - 1] : cells[ix + 1];
            if (next) {
              const r = document.createRange();
              r.selectNodeContents(next);
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
            }
            return;
          }
        }
        // Backspace right after an icon+nbsp pair → delete both in
        // one keystroke. The trailing &nbsp; emitted by
        // renderIconHTML (js/note/icons.mjs) exists to give the
        // caret a reliable landing character after the empty
        // inline-block icon span, but it counts as a character for
        // Backspace — without this handler, users have to press
        // Backspace twice (first removes the nbsp, second removes
        // the icon span) which feels wrong. Guard is tight: only
        // fires when the selection is collapsed AND the caret sits
        // immediately after "<icon-span>\u00A0|" so we don't steal
        // normal Backspace behaviour anywhere else.
        if (key === "backspace" && !mod) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const r = sel.getRangeAt(0);
            if (r.collapsed && this._editArea?.contains(r.startContainer)) {
              const node = r.startContainer;
              const off = r.startOffset;
              if (
                node.nodeType === 3 &&
                off === 1 &&
                node.nodeValue &&
                node.nodeValue[0] === "\u00A0"
              ) {
                const prev = node.previousSibling;
                if (
                  prev &&
                  prev.nodeType === 1 &&
                  prev.classList?.contains("pix-note-ic")
                ) {
                  e.preventDefault();
                  e.stopImmediatePropagation();
                  this._snapBefore?.();
                  prev.remove();
                  node.nodeValue = node.nodeValue.slice(1);
                  // Reposition caret to where the icon used to be.
                  // If the text node still has content, caret goes
                  // to its start; otherwise remove the now-empty
                  // text node and collapse to the parent block end.
                  const parent = node.parentNode;
                  const r2 = document.createRange();
                  if (node.nodeValue.length > 0) {
                    r2.setStart(node, 0);
                  } else {
                    const idx = Array.prototype.indexOf.call(
                      parent.childNodes, node
                    );
                    parent.removeChild(node);
                    r2.setStart(parent, Math.max(0, idx));
                  }
                  r2.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r2);
                  this._snapAfter?.();
                  this._dirty = true;
                  return;
                }
              }
            }
          }
        }
        // Escape → close (with dirty-confirm). If a child modal is open
        // (code dialog, link dialog, block dialog, color popup, or the
        // confirm dialog itself) skip the editor-close so Esc doesn't
        // silently nuke everything. Those modals don't install their own
        // Esc handlers, so nothing happens in that case — user can click
        // Cancel/outside to dismiss.
        if (key === "escape") {
          const hasModal = !!document.querySelector(
            ".pix-note-blockdlg, .pix-note-confirm-backdrop, .pix-note-colorpop, .pix-note-iconpop"
          );
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!hasModal) this.close();
          return;
        }
      }
      e.stopImmediatePropagation();
    };
    // Register on multiple targets in capture phase — ComfyUI/LiteGraph
    // register their own handlers on window/document/canvas with capture,
    // and listener order within the same target is registration order;
    // blanketing these targets maximises the chance we fire before them.
    window.addEventListener("keydown", this._keyBlock, true);
    window.addEventListener("keyup", this._keyBlock, true);
    window.addEventListener("keypress", this._keyBlock, true);
    document.addEventListener("keydown", this._keyBlock, true);
    document.addEventListener("keyup", this._keyBlock, true);
    document.addEventListener("keypress", this._keyBlock, true);
    // Paste/drop into the editArea must NOT reach ComfyUI's global
    // paste/drop listeners. ComfyUI intercepts image paste/drop and spawns
    // a Load Image node on the graph — pasting an image into the Note
    // editor would therefore both (a) embed an <img> in the contenteditable
    // and (b) add an unrelated Load Image node. Register at window capture
    // so we preempt ComfyUI's listener, and rewrite the paste as plain text.
    this._pasteBlock = (e) => {
      if (!this._el || !this._editArea) return;
      const area = this._editArea;
      const inArea = e.target === area || area.contains(e.target);
      if (!inArea) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const text =
        (e.clipboardData || window.clipboardData)?.getData("text/plain") || "";
      if (!text) return;
      if (document.activeElement !== area) area.focus();
      document.execCommand("insertText", false, text);
    };
    this._dropBlock = (e) => {
      if (!this._el) return;
      const inOverlay = this._el.contains(e.target);
      if (!inOverlay) return;
      // Any drop that lands inside our overlay is ours — eat it so ComfyUI
      // can't add a Load Image node. If the drop carried text, insert it.
      e.preventDefault();
      e.stopImmediatePropagation();
      const area = this._editArea;
      const inArea = area && (e.target === area || area.contains(e.target));
      if (inArea) {
        const text = e.dataTransfer?.getData("text/plain") || "";
        if (text) {
          if (document.activeElement !== area) area.focus();
          document.execCommand("insertText", false, text);
        }
      }
    };
    this._dragOverBlock = (e) => {
      if (!this._el || !this._el.contains(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("paste", this._pasteBlock, true);
    document.addEventListener("paste", this._pasteBlock, true);
    window.addEventListener("drop", this._dropBlock, true);
    document.addEventListener("drop", this._dropBlock, true);
    window.addEventListener("dragover", this._dragOverBlock, true);
    document.addEventListener("dragover", this._dragOverBlock, true);
    // Belt-and-suspenders: neuter the graph's undo/redo and the Vue
    // frontend's Comfy.Undo/Comfy.Redo commands while the editor is open
    // so that even if a ComfyUI shortcut listener slips past our capture
    // blocker, the actual undo routines are no-ops.
    if (app.graph) {
      this._savedGraphUndo = app.graph.undo;
      this._savedGraphRedo = app.graph.redo;
      app.graph.undo = function () {};
      app.graph.redo = function () {};
    }
    // The real undo path (seen in the stack trace) is:
    //   changeTracker.undo → app.loadGraphData → graph.configure → graph.clear
    // The wrappers above don't cover this path — `changeTracker.undo` lives
    // in the Vue workflow store, out of reach. Block it by patching the
    // single bottleneck every path goes through: `app.loadGraphData`. While
    // the editor is open, swallow the call so the graph state can't be
    // reloaded (undo/redo, template load, etc. all pause).
    if (typeof app.loadGraphData === "function") {
      this._savedLoadGraphData = app.loadGraphData.bind(app);
      app.loadGraphData = () => {
        console.warn("[pix-note] loadGraphData blocked while note editor is open");
        return Promise.resolve();
      };
    }
    if (app.graph && typeof app.graph.configure === "function") {
      this._savedGraphConfigure = app.graph.configure.bind(app.graph);
      app.graph.configure = () => {
        console.warn("[pix-note] graph.configure blocked while note editor is open");
      };
    }
    // Try to intercept the Vue frontend's command dispatch for Undo/Redo.
    // The exact API differs between ComfyUI versions; wrap whatever we can
    // find so Comfy.Undo and Comfy.Redo become no-ops while editor is open.
    try {
      const cmd = app?.extensionManager?.command;
      const execPath = cmd?.execute ? cmd : (cmd?.commandStore || cmd);
      if (execPath && typeof execPath.execute === "function") {
        this._savedCmdExecute = execPath.execute.bind(execPath);
        const orig = this._savedCmdExecute;
        execPath.execute = (id, ...rest) => {
          if (id === "Comfy.Undo" || id === "Comfy.Redo") return;
          return orig(id, ...rest);
        };
        this._cmdExecPath = execPath;
      }
    } catch (e) { /* Vue frontend API surface may change — non-fatal. */ }
    // Node-resurrection safety net: if Ctrl+Z still slips through and the
    // node is removed from the graph while the editor is open, LiteGraph's
    // onRemoved fires. Close the editor gracefully so the user isn't stuck
    // editing a dead node. Full resurrection (restoring node + state) is
    // impractical because the graph's undo replays a full snapshot.
    this._origOnRemoved = this.node.onRemoved;
    const self = this;
    this.node.onRemoved = function () {
      try { self._origOnRemoved?.call(this); } catch (e) {}
      if (self._el?.isConnected) {
        console.warn("[pix-note] node removed while editor open — closing editor");
        self._dirty = false;
        self.close(true);
      }
    };
    // Vue may remove the overlay without calling close(); observe and clean up.
    this._removalObserver = new MutationObserver(() => {
      if (this._el && !this._el.isConnected) this._cleanup();
    });
    this._removalObserver.observe(document.body, { childList: true, subtree: false });
    requestAnimationFrame(() => this._editArea?.focus());
  }

  async close(force = false) {
    if (this._dirty && !force) {
      const ok = await this._confirmDiscard();
      if (!ok) return;
    }
    this._cleanup();
  }

  _confirmDiscard() {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "pix-note-confirm-backdrop";
      const box = document.createElement("div");
      box.className = "pix-note-confirm-box";
      const title = document.createElement("div");
      title.className = "pix-note-confirm-title";
      title.textContent = "You have unsaved changes";
      const text = document.createElement("div");
      text.className = "pix-note-confirm-text";
      text.textContent = "If you close now, your edits will be lost. What do you want to do?";
      const actions = document.createElement("div");
      actions.className = "pix-note-confirm-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "pix-note-btn primary";
      cancelBtn.textContent = "Keep editing";
      const discardBtn = document.createElement("button");
      discardBtn.className = "pix-note-btn";
      discardBtn.textContent = "Close without saving";
      actions.appendChild(cancelBtn);
      actions.appendChild(discardBtn);
      box.appendChild(title);
      box.appendChild(text);
      box.appendChild(actions);
      backdrop.appendChild(box);
      (this._el || document.body).appendChild(backdrop);
      const finish = (ok) => {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        resolve(ok);
      };
      cancelBtn.addEventListener("click", () => finish(false));
      discardBtn.addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) finish(false);
      });
      requestAnimationFrame(() => cancelBtn.focus());
    });
  }

  _cleanup() {
    if (this._removalObserver) {
      this._removalObserver.disconnect();
      this._removalObserver = null;
    }
    if (this._keyBlock) {
      window.removeEventListener("keydown", this._keyBlock, true);
      window.removeEventListener("keyup", this._keyBlock, true);
      window.removeEventListener("keypress", this._keyBlock, true);
      document.removeEventListener("keydown", this._keyBlock, true);
      document.removeEventListener("keyup", this._keyBlock, true);
      document.removeEventListener("keypress", this._keyBlock, true);
      this._keyBlock = null;
    }
    if (this._pasteBlock) {
      window.removeEventListener("paste", this._pasteBlock, true);
      document.removeEventListener("paste", this._pasteBlock, true);
      this._pasteBlock = null;
    }
    if (this._dropBlock) {
      window.removeEventListener("drop", this._dropBlock, true);
      document.removeEventListener("drop", this._dropBlock, true);
      this._dropBlock = null;
    }
    if (this._dragOverBlock) {
      window.removeEventListener("dragover", this._dragOverBlock, true);
      document.removeEventListener("dragover", this._dragOverBlock, true);
      this._dragOverBlock = null;
    }
    if (this._cmdExecPath && this._savedCmdExecute) {
      this._cmdExecPath.execute = this._savedCmdExecute;
    }
    this._cmdExecPath = null;
    this._savedCmdExecute = null;
    if (this.node && this._origOnRemoved !== undefined) {
      this.node.onRemoved = this._origOnRemoved;
      this._origOnRemoved = undefined;
    }
    if (this._selectionChangeHandler) {
      document.removeEventListener("selectionchange", this._selectionChangeHandler);
      this._selectionChangeHandler = null;
    }
    if (this._onWindowResize) {
      window.removeEventListener("resize", this._onWindowResize);
      this._onWindowResize = null;
    }
    if (this._savedGraphUndo !== undefined) {
      if (app.graph) {
        app.graph.undo = this._savedGraphUndo;
        app.graph.redo = this._savedGraphRedo;
      }
      this._savedGraphUndo = undefined;
      this._savedGraphRedo = undefined;
    }
    if (this._savedLoadGraphData) {
      app.loadGraphData = this._savedLoadGraphData;
      this._savedLoadGraphData = null;
    }
    if (this._savedGraphConfigure) {
      if (app.graph) app.graph.configure = this._savedGraphConfigure;
      this._savedGraphConfigure = null;
    }
    if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    if (this.node && this.node._noteEditor === this) {
      this.node._noteEditor = null;
    }
  }

  save() {
    // If the user is in Code view, persist what they edited in the textarea,
    // not what's currently in the (hidden) WYSIWYG area. sanitize runs either
    // way so malicious markup added in Code view is stripped before storage.
    const raw = this._mode === "code"
      ? (this._codeArea?.value || "")
      : (this._editArea?.innerHTML || "");
    let html;
    try {
      html = sanitize(raw);
    } catch (e) {
      console.error("[pix-note] sanitize threw during save; keeping raw HTML", e, { raw });
      html = raw;
    }
    this.cfg.content = html;
    // Preserve whatever size the node currently has so reload restores it. The
    // editor overlay doesn't itself resize the node — this captures the size the
    // user set on the canvas before opening the editor.
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

    // Robust body lookup — Vue can detach the DOM widget while the
    // fullscreen editor overlay is open (see CLAUDE.md Vue-compat #5).
    // Using `_noteBody` directly risks writing CSS vars / innerHTML on
    // a stale reference that's no longer in the live DOM, which makes
    // per-note picker changes (Bg, Btn, Ln) silently fail to reach
    // the visible canvas body. Prefer live elements; only use cached
    // references if they're still connected.
    let body = null;
    if (this.node._noteBody?.isConnected) {
      body = this.node._noteBody;
    } else if (this.node._noteDOMWrap?.isConnected) {
      body = this.node._noteDOMWrap.querySelector(".pix-note-body");
    } else {
      // Both stale — ask ComfyUI for the current widget element.
      const w = this.node.widgets?.find((x) => x.name === "note_dom");
      body = w?.element?.querySelector?.(".pix-note-body");
    }
    if (body) {
      // Refresh the cached reference so subsequent reads point to the
      // live element, not the stale one we just bypassed.
      this.node._noteBody = body;
      renderContent(this.node, body);
    }

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
      if (e.target !== overlay) return;
      // Block-insert dialogs (grid / button / YT / Discord), color popups,
      // icon picker popup, and confirm backdrops are all appended to
      // document.body — NOT inside this.panel. Without this guard, a
      // mousedown that falls outside the dialog but inside the editor
      // backdrop lands on the overlay and triggers close(), popping an
      // unsaved-changes prompt ON TOP of the still-open modal. Mirrors
      // the same hasModal check the Escape-key handler already uses above.
      const hasModal = !!document.querySelector(
        ".pix-note-blockdlg, .pix-note-confirm-backdrop, .pix-note-colorpop, .pix-note-iconpop"
      );
      if (hasModal) return;
      this.close();
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

    const main = el("div", "pix-note-main");
    panel.appendChild(main);

    // Toolbar placeholder — filled in by toolbar.mjs mixin
    this._toolbarEl = el("div", "pix-note-toolbar");
    main.appendChild(this._toolbarEl);
    this._buildToolbar();

    // Edit area
    const editArea = el("div", "pix-note-editarea");
    editArea.contentEditable = "true";
    editArea.innerHTML = sanitize(this.cfg.content || "");
    // Apply the per-note background colour so the editor interior matches
    // what the on-canvas body will look like after save. Falls back to the
    // editor's dark-gray default (#151515) when the user hasn't picked one.
    this._applyEditAreaBg(editArea);
    // Normalize: wrap any raw text nodes / bare <br>s at the root in <p> so
    // every top-level block operation (code insert, headings, clear-format)
    // can reliably find its enclosing block. Chrome otherwise leaves the
    // first-typed line as a bare text-node child of editArea, which made
    // the code-block insert silently skip the first line on fresh notes.
    this._normalizeEditArea(editArea);
    // Force <p> as Enter's default paragraph separator so spacing stays
    // consistent (Chrome otherwise uses <div>, which has no default margin
    // and looks mismatched against older <p>-wrapped content).
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) {}
    // Manual undo history. We replace the browser's native contenteditable
    // undo entirely because direct-DOM mutations from toolbar buttons (code
    // block insert, etc.) aren't tracked by it. Typing / execCommand
    // operations fire `input` and are captured via the debounced snap below.
    this._history = [];
    this._future = [];
    this._lastSnap = editArea.innerHTML;
    this._snapDebounce = null;
    editArea.addEventListener("input", () => {
      this._dirty = true;
      if (this._snapDebounce) clearTimeout(this._snapDebounce);
      this._snapDebounce = setTimeout(() => {
        this._snapDebounce = null;
        if (this._editArea && this._editArea.innerHTML !== this._lastSnap) {
          this._history.push(this._lastSnap);
          if (this._history.length > 100) this._history.shift();
          this._lastSnap = this._editArea.innerHTML;
          this._future = [];
        }
      }, 400);
    });
    // Clicking the empty padding below text should collapse the selection to
    // the end of the LAST block — Chrome otherwise keeps the old selection
    // since the click didn't land on any text node, and if we collapse to
    // editArea's end the cursor lands OUTSIDE any block, so the next
    // keystroke creates a raw text-node child of editArea (breaks
    // findTopBlock / code-block insert).
    editArea.addEventListener("mousedown", (e) => {
      if (e.target === editArea && e.button === 0) {
        const last = editArea.lastElementChild;
        const range = document.createRange();
        if (last) {
          range.selectNodeContents(last);
          range.collapse(false);
        } else {
          range.selectNodeContents(editArea);
          range.collapse(false);
        }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    // Intercept <a> clicks inside the editor — browsers follow href on
    // any click in a contenteditable, so clicking on a Download / View
    // Page / Read More / YouTube / Discord pill (or any inserted link)
    // to reposition the caret would instead open the URL in a new tab.
    // Users need to be able to click INTO a pill to place the cursor
    // and then Tx-clear-format or delete it. The pencil handles bulk
    // edits; this just lets simple click-to-position work. Use capture
    // so we preempt the anchor's default navigation.
    editArea.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        e.preventDefault();
      }
    }, true);
    main.appendChild(editArea);
    this._editArea = editArea;
    // Write the Btn/Ln CSS vars on editArea NOW that it exists. The
    // makeColorPicker factory inside _buildToolbar() ran before this
    // assignment, so its apply() no-oped on `this._editArea?.`—
    // without this explicit call, the editor preview would fall back
    // to the default orange for lines/buttons on every open even when
    // cfg has a saved color. Click-time picker updates still work via
    // their own apply() call because editArea is set by then.
    this._applyCfgColorsToEditArea();
    // Edit-in-place pencil — one reusable floating button that follows
    // the user's hover across editable blocks. See Task 6 of the Code
    // Readability plan for the full scope.
    this._installPencil(main, editArea);
    this._mode = "preview";

    // Footer
    const footer = el("div", "pix-note-footer");
    const helpBtn = el("button", "pix-note-btn ghost");
    helpBtn.textContent = "? Help";
    helpBtn.onclick = () => this._showHelp();
    // Code Reference — secondary help modal focused on what HTML
    // tags / styles / classes the sanitizer allows in Code view.
    // Split off from the main Help so neither dialog needs a
    // scroll bar.
    const codeRefBtn = el("button", "pix-note-btn ghost");
    codeRefBtn.textContent = "? Code";
    codeRefBtn.onclick = () => this._showCodeRef();
    const cancelBtn = el("button", "pix-note-btn");
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => this.close();
    const saveBtn = el("button", "pix-note-btn primary");
    saveBtn.textContent = "Save";
    saveBtn.onclick = () => this.save();
    footer.appendChild(helpBtn);
    footer.appendChild(codeRefBtn);
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    panel.appendChild(footer);

    this._el = overlay;
  }

  _showHelp() {
    // Append to the editor overlay (viewport-sized, position:fixed),
    // NOT the inner panel. If it's inside the panel, position:absolute
    // top/left 50% centers the modal on the PANEL — which for a tall
    // help (12 sections) often means the top of the modal is clipped
    // ABOVE the panel's top edge, hiding the header + close button.
    // Appending to the overlay makes top:50% + translate(-50%) center
    // on the actual viewport so the whole modal is always visible.
    const host = this._el;
    if (!host) return;
    if (host.querySelector(".pix-note-help-overlay")) return;
    const h = document.createElement("div");
    h.className = "pix-note-help-overlay";
    h.innerHTML = `
      <div class="pix-note-help-header">
        <h3>Note Pixaroma — Shortcuts &amp; Features</h3>
        <button type="button" class="pix-note-help-close" title="Close">\u2715</button>
      </div>
      <div class="pix-note-help-content">
        <div class="pix-note-help-section">
          <h4>Overview</h4>
          <div class="pix-note-help-grid">
            <b>Purpose</b><span>Rich-text annotation node — models to download, nodes used, tutorials. Purely visual; not wired into processing.</span>
            <b>Save</b><span>Ctrl+S or the Save button. Esc prompts if unsaved.</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Text Formatting</h4>
          <div class="pix-note-help-grid">
            <b>B</b><span>Bold (Ctrl+B)</span>
            <b>I</b><span>Italic (Ctrl+I)</span>
            <b>U</b><span>Underline (Ctrl+U)</span>
            <b>S</b><span>Strikethrough</span>
            <b>Broom</b><span>Clear all formatting on selection; demotes headings to paragraph; unwraps code / lists</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Headings</h4>
          <div class="pix-note-help-grid">
            <b>H1 / H2 / H3</b><span>Apply to the current line. Use Broom to demote back to &lt;p&gt;</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Colors</h4>
          <div class="pix-note-help-grid">
            <b>A</b><span>Text color (also used for inline icons)</span>
            <b>Highlight</b><span>Background behind text (execCommand hiliteColor)</span>
            <b>Bg</b><span>Per-note background; drives both editor AND the canvas node. Clear reverts to the dark default</span>
            <b>Btn</b><span>Button-pill color (Download / View Page / Read More)</span>
            <b>Ln</b><span>Line color (grid borders, HR, grid header underline, folder hint)</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Lists</h4>
          <div class="pix-note-help-grid">
            <b>&bull; List</b><span>Bulleted list — click again to toggle off</span>
            <b>1. List</b><span>Numbered list — click again to toggle off</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Inserts</h4>
          <div class="pix-note-help-grid">
            <b>Link</b><span>http, https, or mailto URLs only. Opens in new tab.</span>
            <b>Code</b><span>Code block (&lt;pre&gt;&lt;code&gt;). Multi-line via the themed dialog</span>
            <b>Separator</b><span>&lt;hr&gt; horizontal rule</span>
            <b>Grid</b><span>Table: 2–4 columns × 1–10 rows. Tab navigates cells</span>
            <b>Icon</b><span>SVG from assets/icons/note/. Takes current A color on insert</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Pixaroma Blocks</h4>
          <div class="pix-note-help-grid">
            <b>Button Design</b><span>Rich dialog — Download / View Page / Read More pill with icon + optional folder hint + size tag</span>
            <b>Download pill</b><span>On canvas: click opens URL in new tab AND copies the folder path to clipboard</span>
            <b>YouTube</b><span>Preset Pixaroma YouTube link (override freely)</span>
            <b>Discord</b><span>Preset Pixaroma Discord link (override freely)</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Editing Blocks In Place</h4>
          <div class="pix-note-help-grid">
            <b>Pencil</b><span>Hover a link, pill, code block, or grid-free block — pencil appears, reopens its dialog pre-filled</span>
            <b>Recolor Icon</b><span>Drag-select over the icon, pick a new color in A</span>
            <b>Delete Icon</b><span>Backspace once from right of icon (removes icon + trailing space in one step)</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Views</h4>
          <div class="pix-note-help-grid">
            <b>Preview</b><span>WYSIWYG (default)</span>
            <b>Code</b><span>Raw sanitized HTML with syntax highlight. Edit freely; switching back runs the sanitizer.</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Keyboard</h4>
          <div class="pix-note-help-grid">
            <b>Ctrl+B / I / U</b><span>Bold / Italic / Underline</span>
            <b>Ctrl+Z</b><span>Undo</span>
            <b>Ctrl+Y / Ctrl+Shift+Z</b><span>Redo</span>
            <b>Ctrl+S</b><span>Save</span>
            <b>Tab / Shift+Tab</b><span>Move between grid cells (when inside one)</span>
            <b>Esc</b><span>Close editor (prompts if unsaved)</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Security &amp; Paste</h4>
          <div class="pix-note-help-grid">
            <b>Sanitizer</b><span>&lt;script&gt;, event handlers (onclick, onerror, …), javascript: URLs, &lt;iframe&gt;, &lt;img&gt; are stripped on save AND on paste</span>
            <b>Paste</b><span>Clipboard is converted to plain text; images and rich formatting are dropped to keep notes clean</span>
            <b>URL allowlist</b><span>Links / pills only accept http, https, mailto</span>
          </div>
        </div>
      </div>
      <div class="pix-note-help-footer">
        For the list of HTML tags / styles / classes allowed in Code
        view, click <b>? Code</b> in the footer.<br>
        Designed by <a href="https://www.youtube.com/@pixaroma" target="_blank" rel="noopener noreferrer">Pixaroma</a>
        &middot; <a href="https://github.com/pixaroma/ComfyUI-Pixaroma" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    `;
    const close = h.querySelector(".pix-note-help-close");
    if (close) close.addEventListener("click", () => h.remove());
    host.appendChild(h);
  }

  _showCodeRef() {
    const host = this._el;
    if (!host) return;
    if (host.querySelector(".pix-note-help-overlay")) return;
    const h = document.createElement("div");
    h.className = "pix-note-help-overlay";
    h.innerHTML = `
      <div class="pix-note-help-header">
        <h3>Note Pixaroma — Code View Reference</h3>
        <button type="button" class="pix-note-help-close" title="Close">\u2715</button>
      </div>
      <div class="pix-note-help-content">
        <div class="pix-note-help-section">
          <h4>About Code View</h4>
          <div class="pix-note-help-grid">
            <b>Purpose</b><span>Edit the note's raw HTML directly. Useful for hand-crafting structure the toolbar doesn't expose (nested lists, custom combinations, bulk changes).</span>
            <b>On switch</b><span>Code shows pretty-printed sanitized HTML. Preview re-runs the sanitizer, so anything disallowed is stripped.</span>
            <b>Safety</b><span>The sanitizer is the same on save, paste, AND view-switch. Writing &lt;script&gt; in Code view and switching to Preview removes it.</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Block Tags</h4>
          <div class="pix-note-help-grid">
            <b>&lt;p&gt;</b><span>Paragraph (the default block)</span>
            <b>&lt;h1&gt; / &lt;h2&gt; / &lt;h3&gt;</b><span>Headings</span>
            <b>&lt;blockquote&gt;</b><span>Quoted paragraph (no dedicated toolbar button; hand-write it)</span>
            <b>&lt;pre&gt;</b><span>Code block wrapper</span>
            <b>&lt;hr&gt;</b><span>Horizontal separator</span>
            <b>&lt;div&gt;</b><span>Generic block (allowed but discouraged — prefer &lt;p&gt;)</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Inline Tags</h4>
          <div class="pix-note-help-grid">
            <b>&lt;b&gt; / &lt;strong&gt;</b><span>Bold</span>
            <b>&lt;i&gt; / &lt;em&gt;</b><span>Italic</span>
            <b>&lt;u&gt;</b><span>Underline</span>
            <b>&lt;s&gt; / &lt;strike&gt;</b><span>Strikethrough</span>
            <b>&lt;br&gt;</b><span>Line break</span>
            <b>&lt;a href&gt;</b><span>Link (http, https, mailto only — others stripped; auto-target _blank + rel noopener noreferrer)</span>
            <b>&lt;code&gt;</b><span>Inline code (inside &lt;pre&gt; for blocks)</span>
            <b>&lt;span&gt;</b><span>Generic inline; carries color / highlight / alignment styles AND data-ic for inline icons</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Lists</h4>
          <div class="pix-note-help-grid">
            <b>&lt;ul&gt;</b><span>Bulleted list</span>
            <b>&lt;ol&gt;</b><span>Numbered list</span>
            <b>&lt;li&gt;</b><span>List item (child of ul / ol)</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Tables (Grid)</h4>
          <div class="pix-note-help-grid">
            <b>&lt;table class="pix-note-grid"&gt;</b><span>The pix-note-grid class is required; without it styling doesn't apply.</span>
            <b>&lt;thead&gt; / &lt;tbody&gt;</b><span>Optional head / body wrappers</span>
            <b>&lt;tr&gt;</b><span>Row</span>
            <b>&lt;th&gt; / &lt;td&gt;</b><span>Header cell / data cell. colspan / rowspan NOT allowed.</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Allowed Inline Styles</h4>
          <div class="pix-note-help-grid">
            <b><code>color</code></b><span>Text foreground. Hex only (#rgb or #rrggbb). Other formats stripped.</span>
            <b><code>background-color</code></b><span>Text highlight. Hex only.</span>
            <b><code>text-align</code></b><span>left / right / center / justify</span>
          </div>
          <p style="margin:6px 0 0 0;color:#888;">Any other style (font-size, margin, display, …) is removed on save / paste / view-switch.</p>
        </div>
        <div class="pix-note-help-section">
          <h4>Allowed Classes</h4>
          <div class="pix-note-help-grid">
            <b>pix-note-dl / vp / rm</b><span>Button Design pills (Download / View Page / Read More)</span>
            <b>pix-note-btnblock</b><span>Button pill wrapper with folder hint</span>
            <b>pix-note-btnsize</b><span>Size tag inside a pill</span>
            <b>pix-note-folderhint</b><span>"Place in: …" line under a Download pill</span>
            <b>pix-note-yt / discord</b><span>YouTube / Discord pills</span>
            <b>pix-note-grid</b><span>Tables — required on &lt;table&gt;</span>
            <b>pix-note-ic</b><span>Inline icon span — with data-ic="&lt;slug&gt;" (slug = filename in assets/icons/note/, no .svg)</span>
          </div>
          <p style="margin:6px 0 0 0;color:#888;">Any other class is stripped silently.</p>
        </div>
        <div class="pix-note-help-section">
          <h4>Stripped on Sight</h4>
          <div class="pix-note-help-grid">
            <b>&lt;script&gt;</b><span>Always removed</span>
            <b>&lt;iframe&gt; / &lt;img&gt;</b><span>Always removed</span>
            <b>on*=</b><span>All event handlers (onclick, onerror, onmouseover, …) stripped from every tag</span>
            <b>javascript:</b><span>URL scheme blocked on &lt;a&gt;</span>
            <b>data-*</b><span>Only data-ic is kept (on span). Other data-attrs removed.</span>
          </div>
        </div>
        <div class="pix-note-help-section">
          <h4>Example</h4>
          <pre style="background:#0e0e0e;border:1px solid #2a2a2a;border-radius:4px;padding:8px;color:#ddd;font-size:10px;line-height:1.5;overflow-x:auto;margin:0;">&lt;h2&gt;Workflow overview&lt;/h2&gt;
&lt;p&gt;Install &lt;span data-ic="CLIP" class="pix-note-ic"&gt;&lt;/span&gt;&amp;nbsp;then&lt;/p&gt;
&lt;span class="pix-note-btnblock"&gt;
  &lt;a class="pix-note-dl" href="https://example.com/model.safetensors"
     target="_blank" rel="noopener noreferrer"&gt;Model 2 GB&lt;/a&gt;
  &lt;span class="pix-note-folderhint"&gt;Place in: ComfyUI/models/loras&lt;/span&gt;
&lt;/span&gt;</pre>
        </div>
      </div>
      <div class="pix-note-help-footer">
        Designed by <a href="https://www.youtube.com/@pixaroma" target="_blank" rel="noopener noreferrer">Pixaroma</a>
        &middot; <a href="https://github.com/pixaroma/ComfyUI-Pixaroma" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    `;
    const close = h.querySelector(".pix-note-help-close");
    if (close) close.addEventListener("click", () => h.remove());
    host.appendChild(h);
  }
}

// Flush any pending debounced snap so subsequent push/restore operations see
// the current innerHTML as the baseline.
NoteEditor.prototype._flushDebouncedSnap = function () {
  if (this._snapDebounce) {
    clearTimeout(this._snapDebounce);
    this._snapDebounce = null;
    if (this._editArea && this._editArea.innerHTML !== this._lastSnap) {
      this._history.push(this._lastSnap);
      if (this._history.length > 100) this._history.shift();
      this._lastSnap = this._editArea.innerHTML;
      this._future = [];
    }
  }
};

// Toolbar operations that mutate the DOM directly (not via execCommand) must
// call _snapBefore / _snapAfter so the manual history records them. Operations
// that use execCommand don't need these — the resulting `input` event triggers
// the debounced snap in _build.
NoteEditor.prototype._snapBefore = function () {
  if (!this._editArea) return;
  this._flushDebouncedSnap();
  this._history.push(this._lastSnap);
  if (this._history.length > 100) this._history.shift();
  this._future = [];
};
NoteEditor.prototype._snapAfter = function () {
  if (!this._editArea) return;
  this._lastSnap = this._editArea.innerHTML;
};

NoteEditor.prototype.doUndo = function () {
  if (!this._editArea) return;
  this._flushDebouncedSnap();
  if (!this._history || this._history.length === 0) return;
  this._future.push(this._lastSnap);
  const prev = this._history.pop();
  this._editArea.innerHTML = prev;
  this._lastSnap = prev;
  this._placeCursorAtEnd();
  this._dirty = true;
  this._refreshActiveStates?.();
};

NoteEditor.prototype.doRedo = function () {
  if (!this._editArea) return;
  this._flushDebouncedSnap();
  if (!this._future || this._future.length === 0) return;
  this._history.push(this._lastSnap);
  if (this._history.length > 100) this._history.shift();
  const next = this._future.pop();
  this._editArea.innerHTML = next;
  this._lastSnap = next;
  this._placeCursorAtEnd();
  this._dirty = true;
  this._refreshActiveStates?.();
};

// Wrap any loose text nodes / <br>s at the editArea root in <p> so every
// direct child is a block element. Without this, findTopBlock() called from
// toolbar handlers returns null for the first-typed line on a fresh note
// (Chrome leaves it as a raw text node), and the code-block insert silently
// skipped over it.
NoteEditor.prototype._normalizeEditArea = function (area) {
  const root = area || this._editArea;
  if (!root) return;
  const nodes = Array.from(root.childNodes);
  let currentP = null;
  for (const n of nodes) {
    const isTextish =
      n.nodeType === 3 ||
      (n.nodeType === 1 && (n.tagName === "BR" || n.tagName === "SPAN" ||
        n.tagName === "B" || n.tagName === "STRONG" || n.tagName === "I" ||
        n.tagName === "EM" || n.tagName === "U" || n.tagName === "S" ||
        n.tagName === "STRIKE" || n.tagName === "A" || n.tagName === "CODE" ||
        n.tagName === "FONT" || n.tagName === "LABEL"));
    if (isTextish) {
      if (!currentP) {
        currentP = document.createElement("p");
        root.insertBefore(currentP, n);
      }
      currentP.appendChild(n);
    } else {
      currentP = null;
    }
  }
  if (root.childNodes.length === 0) {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    root.appendChild(p);
  }
};

// Code / Preview view toggle. "Code" shows the sanitized HTML in a textarea
// so power users can tweak markup directly; "Preview" (default) is the
// WYSIWYG contenteditable. Switching in either direction runs sanitize so
// the user sees the exact shape that will be stored.
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
  const cv = buildCodeViewDOM(htmlNow, {
    onInput: () => { this._dirty = true; },
  });
  this._editArea.parentElement.appendChild(cv.root);
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

NoteEditor.prototype._applyEditAreaBg = function (area) {
  const root = area || this._editArea;
  if (!root) return;
  // Priority order for the editor's interior background:
  //   1. cfg.backgroundColor as an explicit hex (user picked in our
  //      Bg picker) — authoritative.
  //   2. node.bgcolor (native right-click Colors menu or an already-
  //      applied default) — so the editor interior matches the
  //      canvas node the user is about to edit. Without this, picking
  //      green via the native picker then opening the editor would
  //      show a dark-gray editor body on top of a green canvas node,
  //      which is confusing.
  //   3. LiteGraph's NODE_DEFAULT_BGCOLOR — hit when the user picked
  //      "no color / default" in the native picker, so node.bgcolor
  //      is null and the canvas is rendering at the LiteGraph theme
  //      default. Matching that in the editor keeps the two surfaces
  //      visually consistent.
  //   4. #111111 ultimate fallback if LiteGraph isn't exposed on
  //      window (shouldn't happen in normal ComfyUI, but defensive).
  const cfgBg = this.cfg.backgroundColor;
  let bg;
  if (typeof cfgBg === "string" && cfgBg && cfgBg !== "transparent") {
    bg = cfgBg;
  } else if (this.node?.bgcolor) {
    bg = this.node.bgcolor;
  } else {
    bg = window.LiteGraph?.NODE_DEFAULT_BGCOLOR || "#111111";
  }
  root.style.background = bg;
};

// Write the Btn/Ln CSS vars onto the edit area based on the current
// cfg. Called at editor open (after _editArea is assigned) so the
// initial render reflects saved colors. makeColorPicker's per-picker
// apply() also writes these, but only when it runs AFTER _editArea is
// set — which isn't the case on editor open. Keeping this method on
// the instance so it can be re-triggered if cfg is swapped later.
NoteEditor.prototype._applyCfgColorsToEditArea = function () {
  const a = this._editArea;
  if (!a) return;
  a.style.setProperty("--pix-note-btn",  this.cfg.buttonColor || "#f66744");
  a.style.setProperty("--pix-note-line", this.cfg.lineColor   || "#f66744");
};

NoteEditor.prototype._placeCursorAtEnd = function () {
  if (!this._editArea) return;
  const range = document.createRange();
  range.selectNodeContents(this._editArea);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  this._editArea.focus();
};

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
  main.appendChild(pencil);
  this._pencil = pencil;
  this._pencilTarget = null;

  let hideTimer = null;
  const show = (target) => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    this._pencilTarget = target;
    this._repositionPencil();
    pencil.classList.add("visible");
  };
  const hide = () => {
    pencil.classList.remove("visible");
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
    pencil.classList.remove("visible");
    return;
  }
  const top = tRect.top - mainRect.top + 4;
  const left = tRect.right - mainRect.left - 26;
  pencil.style.top = `${top}px`;
  pencil.style.left = `${left}px`;
};
