// js/audio_studio/core.mjs
import { app } from "../../../../scripts/app.js";

const BRAND_ORANGE = "#f66744";
const BRAND_RED    = "#e74c3c";

function injectCSS() {
  if (document.getElementById("pix-audiostudio-css")) return;
  const css = `
    .pix-as-overlay {
      position: fixed; inset: 0;
      background: #1c1c1c;
      z-index: 9999;
      display: flex; flex-direction: column;
      color: #e0e0e0;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
    }
    .pix-as-header {
      display: flex; align-items: center;
      gap: 12px;
      padding: 6px 12px;
      background: #2a2a2a;
      border-bottom: 1px solid #1a1a1a;
      height: 32px;
      flex-shrink: 0;
    }
    .pix-as-close-x {
      cursor: pointer;
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #aaa;
      border-radius: 3px;
      user-select: none;
    }
    .pix-as-close-x:hover { background: #3a3a3a; color: #fff; }
    .pix-as-title {
      color: ${BRAND_ORANGE};
      font-weight: bold;
      font-size: 14px;
    }
    .pix-as-pill {
      display: inline-flex; align-items: center;
      padding: 3px 10px; border-radius: 12px;
      background: #3a3a3a; color: #aaa;
      font-size: 11px;
      cursor: pointer; user-select: none;
    }
    .pix-as-pill.connected { background: #2d5a3d; color: #c8e6c9; }
    .pix-as-pill:hover { filter: brightness(1.2); }
    .pix-as-spacer { flex: 1; }
    .pix-as-save-btn {
      background: ${BRAND_ORANGE}; color: #fff;
      padding: 5px 16px; border-radius: 4px;
      font-weight: bold; cursor: pointer; user-select: none;
      border: none; font-size: 13px;
    }
    .pix-as-save-btn:disabled,
    .pix-as-save-btn.disabled {
      background: #555; color: #888;
      cursor: not-allowed;
    }
    .pix-as-save-btn:not(:disabled):not(.disabled):hover { filter: brightness(1.1); }
    .pix-as-body {
      display: flex; flex: 1; min-height: 0;
    }
    .pix-as-canvas-area {
      flex: 1;
      background: #111;
      display: flex; flex-direction: column;
      min-width: 0;
    }
    .pix-as-canvas-host {
      flex: 1;
      display: flex; align-items: center; justify-content: center;
      color: #555;
      position: relative;
    }
    .pix-as-canvas-host canvas {
      display: block;
      max-width: 100%; max-height: 100%;
    }
    .pix-as-transport {
      flex-shrink: 0;
      background: #232323;
      border-top: 1px solid #1a1a1a;
      padding: 6px 12px;
      display: flex; align-items: center; gap: 10px;
      height: 36px;
    }
    .pix-as-sidebar {
      width: 280px;
      background: #232323;
      border-left: 1px solid #1a1a1a;
      display: flex; flex-direction: column;
      flex-shrink: 0;
    }
    .pix-as-confirm-backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    }
    .pix-as-confirm-modal {
      background: #2a2a2a;
      padding: 20px 24px;
      border-radius: 6px;
      max-width: 400px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
    }
    .pix-as-confirm-modal h3 {
      margin: 0 0 12px 0;
      color: ${BRAND_ORANGE};
      font-size: 16px;
    }
    .pix-as-confirm-modal p {
      margin: 0 0 16px 0;
      color: #ccc;
      line-height: 1.4;
    }
    .pix-as-confirm-actions {
      display: flex; gap: 8px; justify-content: flex-end;
    }
    .pix-as-btn {
      padding: 6px 14px; border-radius: 3px;
      cursor: pointer; user-select: none;
      border: none; font-size: 13px; font-weight: bold;
    }
    .pix-as-btn-cancel { background: ${BRAND_ORANGE}; color: #fff; }
    .pix-as-btn-discard { background: ${BRAND_RED}; color: #fff; }
    .pix-as-btn:hover { filter: brightness(1.1); }
  `;
  const style = document.createElement("style");
  style.id = "pix-audiostudio-css";
  style.textContent = css;
  document.head.appendChild(style);
}


export class AudioStudioEditor {
  constructor(node, cfg) {
    this.node = node;
    // Deep-clone cfg so live edits don't mutate node.properties until Save.
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.savedSnapshot = JSON.stringify(cfg);   // for dirty detection
    this.overlay = null;
    this.onSave = null;
    this.onClose = null;
  }

  isDirty() {
    return JSON.stringify(this.cfg) !== this.savedSnapshot;
  }

  open() {
    injectCSS();

    // Vue-compat (CLAUDE.md Pattern #6): neuter Ctrl+Z escape paths while
    // editor is open. Patches restored in forceClose().
    this._savedLoadGraphData = app.loadGraphData.bind(app);
    app.loadGraphData = () => Promise.resolve();
    this._savedGraphConfigure = app.graph.configure.bind(app.graph);
    app.graph.configure = () => {};

    const overlay = document.createElement("div");
    overlay.className = "pix-as-overlay";
    this.overlay = overlay;

    overlay.appendChild(this._buildHeader());

    const body = document.createElement("div");
    body.className = "pix-as-body";

    const canvasArea = document.createElement("div");
    canvasArea.className = "pix-as-canvas-area";
    this.canvasArea = canvasArea;

    const canvasHost = document.createElement("div");
    canvasHost.className = "pix-as-canvas-host";
    canvasHost.textContent = "(canvas — WebGL preview lands in Milestone E)";
    this.canvasHost = canvasHost;

    const transport = document.createElement("div");
    transport.className = "pix-as-transport";
    transport.textContent = "(transport bar — lands in Milestone G)";
    this.transportEl = transport;

    canvasArea.appendChild(canvasHost);
    canvasArea.appendChild(transport);

    const sidebar = document.createElement("div");
    sidebar.className = "pix-as-sidebar";
    // Assign BEFORE _buildSidebar() — the mixin reads `this.sidebar` to
    // populate it. Reversing the order leaves `this.sidebar` undefined
    // and the build throws on `sidebar.textContent = ""`, aborting open()
    // silently before the overlay is appended.
    this.sidebar = sidebar;
    this._buildSidebar();

    body.appendChild(canvasArea);
    body.appendChild(sidebar);
    overlay.appendChild(body);

    document.body.appendChild(overlay);

    // Top-level keydown handler — intercept Esc and Ctrl+S.
    this._keyHandler = (e) => {
      // Don't intercept when a confirm modal is open
      if (document.querySelector(".pix-as-confirm-backdrop")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._save();
      }
    };
    window.addEventListener("keydown", this._keyHandler, true);

    // Block clicks on overlay backdrop from accidentally closing
    // (defense-in-depth — primary close path is the x button or Esc)
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay && document.querySelector(".pix-as-confirm-backdrop")) {
        e.stopImmediatePropagation();
      }
    }, true);
  }

  _buildHeader() {
    const header = document.createElement("div");
    header.className = "pix-as-header";

    const closeX = document.createElement("span");
    closeX.className = "pix-as-close-x";
    closeX.textContent = "×";
    closeX.style.fontSize = "18px";
    closeX.addEventListener("click", () => this.close());
    header.appendChild(closeX);

    const title = document.createElement("span");
    title.className = "pix-as-title";
    title.textContent = "Audio Studio Pixaroma";
    header.appendChild(title);

    // Image / Audio source pills — full behavior in Milestone H
    this.imgPill = this._buildPill(
      `Image: ${this.cfg.image_source === "upstream" ? "Upstream" : "Inline"}`,
      this.cfg.image_source === "upstream",
    );
    this.audioPill = this._buildPill(
      `Audio: ${this.cfg.audio_source === "upstream" ? "Upstream" : "Inline"}`,
      this.cfg.audio_source === "upstream",
    );
    header.appendChild(this.imgPill);
    header.appendChild(this.audioPill);

    const spacer = document.createElement("span");
    spacer.className = "pix-as-spacer";
    header.appendChild(spacer);

    const saveBtn = document.createElement("button");
    saveBtn.className = "pix-as-save-btn disabled";
    saveBtn.textContent = "SAVE";
    saveBtn.disabled = true;   // enabled by ui.mjs / D4 when dirty
    saveBtn.addEventListener("click", () => this._save());
    this.saveBtn = saveBtn;
    header.appendChild(saveBtn);

    return header;
  }

  _buildPill(label, connected) {
    const pill = document.createElement("span");
    pill.className = "pix-as-pill" + (connected ? " connected" : "");
    pill.textContent = label;
    return pill;
  }

  _refreshSaveBtnState() {
    const dirty = this.isDirty();
    this.saveBtn.disabled = !dirty;
    this.saveBtn.classList.toggle("disabled", !dirty);
  }

  _save() {
    if (!this.isDirty()) return;
    this.onSave?.(JSON.parse(JSON.stringify(this.cfg)));
    this.savedSnapshot = JSON.stringify(this.cfg);
    this._refreshSaveBtnState();
    this.close();
  }

  _onCfgChanged() {
    this._refreshSaveBtnState();
    // Render hook — currently a no-op stub. E2 mixin will define _render;
    // audio analysis (F2) will recompute audio textures.
    this._render?.();
  }

  close() {
    if (this.isDirty()) {
      this._showDiscardConfirm();
      return;
    }
    this.forceClose();
  }

  _showDiscardConfirm() {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-as-confirm-backdrop";
    const modal = document.createElement("div");
    modal.className = "pix-as-confirm-modal";
    modal.innerHTML = `
      <h3>Discard changes?</h3>
      <p>You have unsaved changes to the Audio Studio. Discard them and close?</p>
      <div class="pix-as-confirm-actions">
        <button class="pix-as-btn pix-as-btn-cancel">Cancel</button>
        <button class="pix-as-btn pix-as-btn-discard">Discard</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    modal.querySelector(".pix-as-btn-cancel").focus();
    modal.querySelector(".pix-as-btn-cancel").addEventListener("click", () => {
      backdrop.remove();
    });
    modal.querySelector(".pix-as-btn-discard").addEventListener("click", () => {
      backdrop.remove();
      this.forceClose();
    });
  }

  forceClose() {
    // Restore Vue-compat patches
    if (this._savedLoadGraphData) {
      app.loadGraphData = this._savedLoadGraphData;
      this._savedLoadGraphData = null;
    }
    if (this._savedGraphConfigure) {
      app.graph.configure = this._savedGraphConfigure;
      this._savedGraphConfigure = null;
    }
    if (this._keyHandler) {
      window.removeEventListener("keydown", this._keyHandler, true);
      this._keyHandler = null;
    }
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.onClose?.();
  }
}
