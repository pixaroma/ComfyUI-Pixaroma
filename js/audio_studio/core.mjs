// js/audio_studio/core.mjs
import { app } from "../../../../scripts/app.js";
import { decodeAudio, computeAll } from "./audio_analysis.mjs";

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
    // Undo / redo (G4) — bounded LIFO of JSON snapshots, ~50 entries.
    // _lastSnapshot is the cfg at the most recent commit point (initial
    // open OR latest debounced snap), used as the diff baseline.
    this._undoStack = [];
    this._redoStack = [];
    this._lastSnapshot = JSON.stringify(this.cfg);
    this._snapTimer = null;
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
    this.transportEl = transport;
    // Mixin lives in transport.mjs — built after overlay is in DOM (see below).

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

    // Initialise WebGL2 renderer now that canvasHost is in the DOM (so
    // getBoundingClientRect() returns real dimensions). Mixin lives in
    // render.mjs.
    this._initRenderer();

    // Build transport bar (mixin in transport.mjs). Needs canvasHost-adjacent
    // DOM in place so getBoundingClientRect() resolves for the sparkline.
    this._buildTransport();
    this._refreshTransport();

    // TEMP — remove in H1
    // Load the parity test image so we have something to render until
    // upstream / inline source resolution lands in Milestone H.
    const testImg = new Image();
    testImg.crossOrigin = "Anonymous";
    testImg.onload = () => this._setImage?.(testImg);
    testImg.onerror = () => console.warn("[Pixaroma] Audio Studio test image fetch failed");
    // Note: WEB_DIRECTORY only exposes ./js at /extensions/<plugin>/, NOT
    // ./assets. Pixaroma serves assets via the /pixaroma/assets/.../ route
    // family in server_routes.py.
    testImg.src = "/pixaroma/assets/audio_studio_parity/test_image.png";

    // Top-level keydown handler — intercept Esc, Ctrl+S, Space, arrows,
    // Ctrl+Z, Ctrl+Y. Inputs / textareas / dropdowns keep their default
    // behavior (we check tagName before hijacking the key).
    this._keyHandler = (e) => {
      // Don't intercept when a confirm modal is open
      if (document.querySelector(".pix-as-confirm-backdrop")) return;
      const t = e.target;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._save();
      } else if (e.code === "Space" && !inField) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._togglePlay?.();
      } else if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && !inField) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const sign = e.code === "ArrowLeft" ? -1 : 1;
        // Shift+arrow steps fps frames (1s); plain arrow steps 1 frame.
        const stepFrames = e.shiftKey ? Math.max(1, this.cfg.fps) : 1;
        this._stepFrame?.(sign * stepFrames);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._undo?.();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && (e.key === "Z" || e.key === "z")))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._redo?.();
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
    // Snap for undo BEFORE other side-effects so Ctrl+Z restores to the
    // pre-change state. Debounced (200ms) so dragging a slider doesn't
    // flood the stack — only the settled value is captured.
    this._snapForUndo(false);
    this._refreshSaveBtnState();
    // fps / smoothing / loop_safe changes invalidate the cached envelope —
    // recompute from the decoded buffer if we have one. Cheap (well under a
    // second for typical clips) so no need to debounce yet.
    if (this._audioBuffer) this._recomputeAudio();
    this._render?.();
  }

  // ---------------- Undo / redo (G4) ----------------

  /**
   * Push the current cfg onto the undo stack so a later Ctrl+Z can restore
   * it. immediate=false debounces (200ms) — used by slider drags so a
   * smooth drag captures only the settled value. immediate=true commits
   * right away — used by source-file changes (image/audio load) where the
   * snap is one discrete event.
   */
  _snapForUndo(immediate) {
    const snapshot = JSON.stringify(this.cfg);
    if (this._lastSnapshot === snapshot) return;
    if (this._snapTimer) clearTimeout(this._snapTimer);
    const commit = () => {
      this._undoStack.push(this._lastSnapshot ?? snapshot);
      this._lastSnapshot = JSON.stringify(this.cfg);
      if (this._undoStack.length > 50) this._undoStack.shift();
      this._redoStack.length = 0;   // any new edit invalidates redo branch
      this._snapTimer = null;
    };
    if (immediate) commit();
    else this._snapTimer = setTimeout(commit, 200);
  }

  _undo() {
    if (this._undoStack.length === 0) return;
    const cur = JSON.stringify(this.cfg);
    this._redoStack.push(cur);
    const prev = this._undoStack.pop();
    this.cfg = JSON.parse(prev);
    this._lastSnapshot = prev;
    this._refreshAfterRestore();
  }

  _redo() {
    if (this._redoStack.length === 0) return;
    const cur = JSON.stringify(this.cfg);
    this._undoStack.push(cur);
    const nxt = this._redoStack.pop();
    this.cfg = JSON.parse(nxt);
    this._lastSnapshot = nxt;
    this._refreshAfterRestore();
  }

  /**
   * Rebuild sidebar (cheapest way to ensure widgets reflect this.cfg) +
   * recompute audio (envelope depends on fps/smoothing/loop_safe) +
   * rerender. Save button state derived from the same dirty check.
   */
  _refreshAfterRestore() {
    this._buildSidebar();
    this._refreshSaveBtnState();
    if (this._audioBuffer) this._recomputeAudio();
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
    // Stop any active playback + detach window-level scrub listeners
    // before the overlay leaves the DOM (otherwise they leak the closure
    // back into a removed overlay).
    this._pausePlayback?.();
    this._detachTransportListeners?.();
    // Tear down GL resources before the overlay (and its canvas) leaves
    // the DOM. Mixin lives in render.mjs.
    this._destroyRenderer?.();
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.onClose?.();
  }
}

// ---------------------------------------------------------------------------
// Audio loading + analysis (F2)
// ---------------------------------------------------------------------------

/**
 * Load an audio Blob, decode via Web Audio API, run analysis, push the
 * result into the renderer's audio textures. Idempotent — replaces any
 * previously-loaded audio. Source-loading UX (file picker, drag-drop,
 * upstream-aware URL resolution) lands in Milestone H; this method is the
 * common backend they all funnel into.
 */
AudioStudioEditor.prototype.loadAudioBlob = async function (blob) {
  this._audioBlob = blob;
  const ab = await blob.arrayBuffer();
  const buf = await decodeAudio(ab);
  this._audioBuffer = buf;
  this._recomputeAudio();
};

/**
 * Recompute envelope + onset from the cached AudioBuffer using the current
 * cfg (fps / smoothing / loop_safe). Called on initial load and on every
 * cfg change that affects analysis output.
 */
AudioStudioEditor.prototype._recomputeAudio = function () {
  if (!this._audioBuffer) return;
  const { envelope, onset, totalFrames } = computeAll(
    this._audioBuffer, this.cfg.fps, this.cfg.smoothing, this.cfg.loop_safe,
  );
  if (totalFrames > 0) {
    // Cache the envelope so transport.mjs's _drawSparkline can read it
    // (avoids passing it in or recomputing).
    this._envArray = envelope;
    this._setAudioTextures(envelope, onset, totalFrames);
    this._currentFrame = 0;
    this._refreshTransport?.();
    this._drawSparkline?.();
    this._render();
  }
};
