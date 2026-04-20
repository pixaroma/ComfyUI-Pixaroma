import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";
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
    // No installFocusTrap here — its mouseup refocus steals selection from
    // the contenteditable edit area when a drag-select ends outside it.
    // Key isolation is handled below via _keyBlock.
    this._keyBlock = (e) => e.stopImmediatePropagation();
    window.addEventListener("keydown", this._keyBlock, true);
    window.addEventListener("keyup", this._keyBlock, true);
    window.addEventListener("keypress", this._keyBlock, true);
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
      this._keyBlock = null;
    }
    if (this._selectionChangeHandler) {
      document.removeEventListener("selectionchange", this._selectionChangeHandler);
      this._selectionChangeHandler = null;
    }
    if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    if (this.node && this.node._noteEditor === this) {
      this.node._noteEditor = null;
    }
  }

  save() {
    const html = sanitize(this._editArea?.innerHTML || "");
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
    editArea.addEventListener("input", () => { this._dirty = true; });
    // Clicking the empty padding below text should collapse the selection to
    // the end — Chrome otherwise keeps the old selection since the click
    // didn't land on any text node.
    editArea.addEventListener("mousedown", (e) => {
      if (e.target === editArea && e.button === 0) {
        const range = document.createRange();
        range.selectNodeContents(editArea);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
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
