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
        // Escape → close (with dirty-confirm). If a child modal is open
        // (code dialog, link dialog, block dialog, color popup, or the
        // confirm dialog itself) skip the editor-close so Esc doesn't
        // silently nuke everything. Those modals don't install their own
        // Esc handlers, so nothing happens in that case — user can click
        // Cancel/outside to dismiss.
        if (key === "escape") {
          const hasModal = !!document.querySelector(
            ".pix-note-blockdlg, .pix-note-confirm-backdrop, .pix-note-colorpop"
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
      // and confirm backdrops are all appended to document.body — NOT
      // inside this.panel. Without this guard, a mousedown that falls
      // outside the dialog but inside the editor backdrop lands on the
      // overlay and triggers close(), popping an unsaved-changes prompt
      // ON TOP of the still-open modal. Mirrors the same hasModal check
      // the Escape-key handler already uses above.
      const hasModal = !!document.querySelector(
        ".pix-note-blockdlg, .pix-note-confirm-backdrop, .pix-note-colorpop"
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
    if (panel.querySelector(".pix-note-help")) return;
    const h = document.createElement("div");
    h.className = "pix-note-help";
    h.innerHTML = `
      <h3>Note Pixaroma</h3>
      <p><b>Purpose:</b> Annotate your workflow with rich formatted notes — models to download, nodes used, tutorials. Purely visual; not wired into processing.</p>
      <p><b>Text:</b> Bold (Ctrl+B), Italic (Ctrl+I), Underline (Ctrl+U), Strikethrough. The broom icon clears all formatting on the current selection.</p>
      <p><b>Headings:</b> H1 / H2 / H3 apply to the current line. Use the broom to demote back to a paragraph.</p>
      <p><b>Colors:</b> <b>A</b> changes text color, <b>■</b> changes highlight, <b>Bg</b> sets the editor + on-canvas background, <b>Ac</b> sets the per-note accent color (drives Download pill tint and link color).</p>
      <p><b>Lists:</b> bulleted and numbered. Click the list button again to toggle off.</p>
      <p><b>Inserts:</b> 🔗 link (http, https, or mailto only), ⟨/⟩ code block, — horizontal separator. Download / YouTube / Discord blocks live in the Pixaroma group.</p>
      <p><b>⬇ Download:</b> inserts a pill button. On the canvas, clicking the pill opens the URL in a new tab AND copies the target folder path to your clipboard — paste it into your browser's Save As dialog.</p>
      <p><b>🎥 YouTube / 💬 Discord:</b> preset Pixaroma links with defaults prefilled. Override freely.</p>
      <p><b>Code / Preview:</b> top-right toggle. Code view shows raw sanitized HTML; Preview is WYSIWYG. Switching in either direction runs the sanitizer.</p>
      <p><b>Security:</b> any &lt;script&gt;, event handler (onclick, onerror, …), javascript: URL, &lt;iframe&gt;, or &lt;img&gt; you paste / write is stripped automatically.</p>
      <p><b>Paste:</b> clipboard content is converted to plain text — images and rich formatting are dropped to keep notes clean.</p>
      <p><b>Save:</b> Ctrl+S or the Save button. Esc prompts if you have unsaved changes. Ctrl+Z / Ctrl+Y undo/redo.</p>
      <p style="margin-top:14px;color:#888">Pixaroma &mdash; <a href="https://www.youtube.com/@pixaroma" target="_blank" rel="noopener noreferrer">youtube.com/@pixaroma</a></p>
    `;
    const close = document.createElement("button");
    close.className = "pix-note-help-close";
    close.type = "button";
    close.innerHTML = "\u00d7";
    close.onclick = () => h.remove();
    h.appendChild(close);
    panel.appendChild(h);
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
  const bg = this.cfg.backgroundColor;
  if (bg === "transparent") {
    root.style.background = "transparent";
  } else {
    root.style.background = bg || "#111111";
  }
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
