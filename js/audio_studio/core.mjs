// js/audio_studio/core.mjs
import { app } from "../../../../scripts/app.js";
import { decodeAudio, computeAll, encodeWav, getAudioContext } from "./audio_analysis.mjs";
import { getUpstreamImageUrl, getInlineSourceUrl, uploadSource, getSysInfo } from "./api.mjs";
import { createEditorLayout, createButton } from "../framework/index.mjs";
import { UI_ICON } from "../framework/theme.mjs";
import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";

const BRAND_ORANGE = "#f66744";
const BRAND_RED    = "#e74c3c";

/**
 * Mirror of `process_aspect()` in nodes/_audio_react_engine.py — given an
 * aspect_ratio string and the user's stored custom W/H, return {w, h} the
 * engine will render at (snapped to mult-of-8 the same way Python does).
 * Returns null for "Original" because that size depends on the upstream
 * image dimensions which aren't known at cfg-edit time.
 *
 * Lives here (NOT in ui.mjs) to keep ui.mjs's import graph one-way into
 * core.mjs. Putting this helper in ui.mjs and importing it into core.mjs
 * creates a cycle (core.mjs → ui.mjs → core.mjs) that breaks the mixin
 * pattern: ui.mjs evaluates against a partially-loaded core.mjs and the
 * `AudioStudioEditor.prototype.foo = ...` lines fail silently, leaving
 * the editor class without its UI methods. ui.mjs imports this from
 * core.mjs instead.
 */
export function computeEngineWH(ar, customW, customH) {
  if (ar === "Original") return null;
  let bw, bh;
  if (ar === "Custom (Use Width & Height below)") {
    bw = customW; bh = customH;
  } else if (ar.startsWith("Custom Ratio")) {
    bw = customW;
    if      (ar.includes("16:9")) bh = Math.floor(bw * 9 / 16);
    else if (ar.includes("9:16")) bh = Math.floor(bw * 16 / 9);
    else if (ar.includes("4:3"))  bh = Math.floor(bw * 3 / 4);
    else if (ar.includes("1:1"))  bh = bw;
    else                          bh = customH;
  } else {
    const [wStr, hStr] = (ar.split(" ")[0] || "").split("x");
    const w = parseInt(wStr, 10), h = parseInt(hStr, 10);
    if (Number.isFinite(w) && Number.isFinite(h)) { bw = w; bh = h; }
    else { bw = customW; bh = customH; }
  }
  bw = Math.floor(bw / 8) * 8;
  bh = Math.floor(bh / 8) * 8;
  return { w: bw, h: bh };
}

/**
 * AudioReact specific styles. The Pixaroma framework (createEditorLayout)
 * supplies the overlay / titlebar / sidebars / footer / discard prompt CSS;
 * we only inject what's unique to this editor: the source-row in the top
 * options bar, the canvas + transport bar inside the workspace, and the
 * tabbed-controls layout inside the right sidebar.
 */
function injectAudioStudioCSS() {
  if (document.getElementById("pix-audiostudio-css")) return;
  const css = `
    /* Source row (in topOptionsBar) — image/audio upload buttons + status */
    .pix-as-source-row {
      display: flex; align-items: center; gap: 8px;
      width: 100%;
    }
    .pix-as-source-cell {
      display: flex; align-items: center; gap: 6px;
      padding: 2px 6px;
    }
    .pix-as-source-cell-status {
      color: #aaa; font-size: 11px;
      min-width: 90px;
      max-width: 220px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pix-as-source-cell-status.connected { color: #c8e6c9; }
    .pix-as-source-divider {
      width: 1px; height: 18px;
      background: #3a3a3a;
      margin: 0 4px;
    }
    /* RAM-need pill — pinned to right end of the source row via margin:auto.
       Colour ramps from neutral → green → amber → red as the estimated RAM
       approaches and exceeds the engine's safety cap. */
    .pix-as-mem-pill {
      margin-left: auto;
      display: flex; align-items: center; gap: 8px;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 11px;
      background: #2a2a2a;
      border: 1px solid #3a3a3a;
      white-space: nowrap;
      cursor: default;
    }
    .pix-as-mem-pill .label { color: #888; }
    .pix-as-mem-pill .value { color: #ddd; font-weight: 600; font-family: monospace; }
    .pix-as-mem-pill .sep   { color: #555; }
    .pix-as-mem-pill.ok    { border-color: #4caf50; background: rgba(76,175,80,0.10); }
    .pix-as-mem-pill.ok    .value { color: #c8e6c9; }
    .pix-as-mem-pill.warn  { border-color: #ff9800; background: rgba(255,152,0,0.10); }
    .pix-as-mem-pill.warn  .value { color: #ffcc80; }
    .pix-as-mem-pill.err   { border-color: #e74c3c; background: rgba(231,76,60,0.10); }
    .pix-as-mem-pill.err   .value { color: #f5b7b1; }

    /* Canvas host inside framework workspace */
    .pix-as-canvas-host {
      flex: 1;
      display: flex; align-items: center; justify-content: center;
      color: #555;
      position: relative;
      width: 100%;
    }
    .pix-as-canvas-host canvas {
      display: block;
      max-width: 100%; max-height: 100%;
    }

    /* Wrap the workspace contents so canvas + transport stack vertically.
       Framework's .pxf-workspace defaults to align-items:center, which
       conflicts — we override here. */
    .pix-as-workspace-stack {
      flex: 1;
      display: flex; flex-direction: column;
      min-height: 0; min-width: 0;
      width: 100%; height: 100%;
    }

    /* Transport bar (at bottom of workspace) */
    .pix-as-transport {
      flex-shrink: 0;
      background: #232323;
      border-top: 1px solid #1a1a1a;
      padding: 6px 12px;
      display: flex; align-items: center; gap: 10px;
      height: 36px;
    }

    /* Discard-changes modal (used by close() when there are unsaved edits). */
    .pix-as-confirm-backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 100000;
      display: flex; align-items: center; justify-content: center;
    }
    .pix-as-confirm-modal {
      background: #2a2a2a;
      padding: 24px 28px 20px;
      border-radius: 8px;
      max-width: 420px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
      color: #e0e0e0;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
    }
    .pix-as-confirm-modal h3 {
      margin: 0 0 10px 0;
      color: ${BRAND_ORANGE};
      font-size: 17px;
      font-weight: 600;
    }
    .pix-as-confirm-modal p {
      margin: 0 0 20px 0;
      color: #ccc;
      line-height: 1.5;
    }
    .pix-as-confirm-actions {
      display: flex; gap: 10px; justify-content: flex-end;
    }
    .pix-as-btn {
      padding: 8px 18px; border-radius: 5px;
      cursor: pointer; user-select: none;
      border: none; font-size: 13px; font-weight: 600;
      transition: filter 0.1s, transform 0.05s;
    }
    .pix-as-btn-cancel { background: ${BRAND_ORANGE}; color: #fff; }
    .pix-as-btn-discard { background: ${BRAND_RED}; color: #fff; }
    .pix-as-btn:hover { filter: brightness(1.1); }
    .pix-as-btn:active { transform: translateY(1px); }
  `;
  const style = document.createElement("style");
  style.id = "pix-audiostudio-css";
  style.textContent = css;
  document.head.appendChild(style);
}


export class AudioStudioEditor {
  constructor(node, cfg, defaults) {
    this.node = node;
    // Deep-clone cfg so live edits don't mutate node.properties until Save.
    this.cfg = JSON.parse(JSON.stringify(cfg));
    // Frozen reference to the original defaults, used by the per-section
    // Reset buttons. Cloned so caller mutations to DEFAULT_CFG can't reach us.
    this._defaults = defaults ? JSON.parse(JSON.stringify(defaults)) : {};
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
    // _uploadDirty covers the case where an upload replaced bytes at an
    // already-saved path (same node id + same extension overwrites the
    // existing audio_studio/<id>/image.png) — the cfg JSON didn't change
    // but the actual file did, so we still need to let the user save.
    if (this._uploadDirty) return true;
    return JSON.stringify(this.cfg) !== this.savedSnapshot;
  }

  open() {
    injectAudioStudioCSS();

    // Vue-compat (CLAUDE.md Pattern #6): neuter Ctrl+Z escape paths while
    // editor is open. Patches restored in forceClose() - AND they self-heal
    // (Vue Compat #2): if the overlay is torn down without forceClose running
    // (e.g. closing the workflow tab while the editor is open), the patches
    // would otherwise stay installed forever and the user could no longer open
    // or create ANY workflow until a page refresh. Each wrapper checks whether
    // our overlay is still in the DOM; if it's gone, it restores the originals
    // and passes the call through. Ctrl+Z while the editor is genuinely open
    // is still blocked.
    // Shared, refcount-safe, self-healing guard. Also covers graph.undo/redo +
    // the Comfy.Undo/Redo command (the old inline version only did
    // loadGraphData/configure, so the command-store undo path could still
    // escape), and refcounts so two editors closing FIFO can't brick the UI.
    this._undoGuardOff = installGraphUndoGuard(() => this._overlayAlive());

    // Build the standard Pixaroma editor shell. This gives us:
    //   * .pxf-titlebar with logo + "AudioReact Pixaroma" + undo/redo + close
    //   * .pxf-top-options bar (we put image/audio source row here)
    //   * .pxf-workspace (canvas + transport go here, stacked vertically)
    //   * .pxf-sidebar-right (our tabbed controls go here)
    //   * .pxf-sidebar-footer with the SAVE button
    // Same shell as Paint Studio / Image Composer / Crop / 3D Builder so
    // users get consistent close/save/undo positions across all editors.
    const layout = createEditorLayout({
      editorName: "AudioReact",
      editorId: "pixaroma-audio-studio-editor",
      leftWidth: 0,                  // no left sidebar — controls live on the right
      rightWidth: 280,
      showZoomBar: false,            // canvas autosizes, no zoom needed
      showUndoRedo: true,
      showStatusBar: false,
      showTopOptionsBar: true,
      onSave: () => this._save(),
      onClose: () => this.close(),
      onUndo: () => this._undo(),
      onRedo: () => this._redo(),
      helpContent: `
        <b>Play / pause:</b> <kbd>Space</kbd><br>
        <b>Frame step:</b> <kbd>←</kbd> / <kbd>→</kbd><br>
        <b>One-second jump:</b> <kbd>Shift+←</kbd> / <kbd>Shift+→</kbd><br>
        <b>Undo / redo:</b> <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd><br>
        <b>Save:</b> <kbd>Ctrl+S</kbd><br>
        <b>Close:</b> <kbd>Esc</kbd><br>
        <hr>
        <b>Sources:</b> wire IMAGE / AUDIO into the node, OR click an upload
        button to load inline. Uploading queues a wire disconnect that
        commits on Save (Discard keeps the wire intact).<br>
        <b>Drag-drop:</b> drop an image or audio file on the canvas.
        <hr>
        <b>System RAM needed</b> (not VRAM, at 24&nbsp;fps):<br>
        <table style="margin-top:6px;border-collapse:collapse;font-size:11px;">
          <tr style="color:#999;">
            <th style="text-align:left;padding:3px 10px 3px 0;">Length</th>
            <th style="text-align:left;padding:3px 10px;">512×512</th>
            <th style="text-align:left;padding:3px 10px;">1280×720</th>
            <th style="text-align:left;padding:3px 10px;">1920×1080</th>
          </tr>
          <tr><td style="padding:2px 10px 2px 0;">30&nbsp;sec</td>
              <td style="padding:2px 10px;">2.1&nbsp;GB</td>
              <td style="padding:2px 10px;">7.4&nbsp;GB</td>
              <td style="padding:2px 10px;">16.7&nbsp;GB</td></tr>
          <tr><td style="padding:2px 10px 2px 0;">1&nbsp;min</td>
              <td style="padding:2px 10px;">4.2&nbsp;GB</td>
              <td style="padding:2px 10px;">14.8&nbsp;GB</td>
              <td style="padding:2px 10px;">33.4&nbsp;GB</td></tr>
          <tr><td style="padding:2px 10px 2px 0;">3&nbsp;min</td>
              <td style="padding:2px 10px;">12.7&nbsp;GB</td>
              <td style="padding:2px 10px;">44.5&nbsp;GB</td>
              <td style="padding:2px 10px;">100&nbsp;GB</td></tr>
        </table>
        <span style="color:#999;font-size:11px;">
          At 30&nbsp;fps multiply by 1.25, at 60&nbsp;fps by 2.5. The pill at
          the top right shows the live estimate for your current settings.
        </span>
      `,
    });
    this._layout = layout;
    this.overlay = layout.overlay;

    // ── Top options bar: image / audio source row ─────────────────
    this._buildSourceRow(layout.topOptionsBar);

    // ── Workspace: vertical stack (canvas host + transport bar) ───
    const stack = document.createElement("div");
    stack.className = "pix-as-workspace-stack";

    const canvasHost = document.createElement("div");
    canvasHost.className = "pix-as-canvas-host";
    this.canvasHost = canvasHost;

    const transport = document.createElement("div");
    transport.className = "pix-as-transport";
    this.transportEl = transport;

    stack.appendChild(canvasHost);
    stack.appendChild(transport);
    layout.workspace.appendChild(stack);

    // ── Right sidebar: tabbed controls (mixin populates) ───────────
    // The framework already appends a footer with Save button. Insert our
    // tab controls BEFORE the footer so they don't push it out of view.
    const sidebar = document.createElement("div");
    sidebar.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;";
    layout.rightSidebar.insertBefore(sidebar, layout.sidebarFooter);
    this.sidebar = sidebar;
    this._buildSidebar();

    // Mount overlay into DOM (also installs framework focus trap +
    // global keyboard blocker — we override its behavior below).
    layout.mount();

    // AudioReact doesn't have a "Save to Disk" path (workflow output is
    // an MP4 produced by Save Mp4 Pixaroma downstream, not a flat image).
    // Hide the framework's secondary footer button so the Save button gets
    // the full footer width.
    if (layout.closeBtn) {
      layout.closeBtn.style.display = "none";
      if (layout.saveBtn) layout.saveBtn.style.flex = "1 1 100%";
    }

    // The framework's mount() installs an aggressive keyboard blocker
    // that swallows Space / arrows. Replace it with our own that only
    // blocks Ctrl+Z escape paths and routes our shortcuts to the editor.
    layout._kbBlock && window.removeEventListener("keydown", layout._kbBlock, { capture: true });
    layout._kbBlock && window.removeEventListener("keyup",   layout._kbBlock, { capture: true });
    layout._kbBlock && window.removeEventListener("keypress", layout._kbBlock, { capture: true });
    layout._kbBlock = null;

    // Init renderer once canvasHost is in DOM (getBoundingClientRect needs it)
    this._initRenderer();
    this._buildTransport();
    this._refreshTransport();
    this._refreshUndoButtonsState();

    this._resolveImageSource();
    this._resolveAudioSource();
    this._initSysInfo();

    // Drag-drop image / audio onto the canvas (or anywhere in the workspace).
    layout.workspace.addEventListener("dragover", (e) => { e.preventDefault(); });
    layout.workspace.addEventListener("drop", async (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (file.type.startsWith("image/")) {
        try {
          const ext = (file.name.split(".").pop() || "png").toLowerCase();
          const filename = `image.${ext === "jpg" ? "jpg" : ext}`;
          const { path } = await uploadSource(this.node.id, "image", file, filename);
          this.cfg.image_source = "inline";
          this.cfg.image_path = path;
          this.cfg.image_force_inline = true;
          this.cfg.image_uploaded_at = Date.now();
          this._uploadDirty = true;
          this._queueWireDisconnect("image");
          this._snapForUndo(true);
          this._refreshSaveBtnState();
          await this._resolveImageSource();
        } catch (err) { alert("Image upload failed: " + err.message); }
      } else if (file.type.startsWith("audio/") || /\.(wav|mp3|ogg|aac|flac|m4a)$/i.test(file.name)) {
        await this._handleAudioFile(file);
      }
    });

    // React to upstream disconnect / reconnect while editor is open.
    this._origOnConnectionsChange = this.node.onConnectionsChange?.bind(this.node);
    this.node.onConnectionsChange = (type, slotIndex, connected) => {
      this._origOnConnectionsChange?.(type, slotIndex, connected);
      if (type !== 1) return;   // LiteGraph.INPUT === 1
      const inputName = this.node.inputs?.[slotIndex]?.name;
      if (inputName === "image") this._resolveImageSource();
      else if (inputName === "audio") this._resolveAudioSource();
    };

    // Editor-scope keyboard shortcuts. Capture phase so they preempt
    // ComfyUI shortcuts. Inputs / textareas / dropdowns keep default keys.
    this._keyHandler = (e) => {
      // Skip when a discard / native modal is open
      if (document.querySelector(".pxf-confirm-backdrop, .pix-as-confirm-backdrop")) return;
      const t = e.target;
      // The framework installs a hidden <textarea data-pixaroma-trap="1">
      // for keyboard-shortcut isolation; it grabs focus when the user
      // clicks on the workspace background. Don't treat it as a real text
      // field or Space / arrows / Ctrl+Z would all be swallowed.
      const isTrap = t && t.dataset?.pixaromaTrap === "1";
      const inField = !isTrap && t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

      if (e.key === "Escape") {
        e.preventDefault(); e.stopImmediatePropagation();
        this.close();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault(); e.stopImmediatePropagation();
        this._save();
      } else if (e.code === "Space" && !inField) {
        e.preventDefault(); e.stopImmediatePropagation();
        this._togglePlay?.();
      } else if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && !inField) {
        e.preventDefault(); e.stopImmediatePropagation();
        const sign = e.code === "ArrowLeft" ? -1 : 1;
        const stepFrames = e.shiftKey ? Math.max(1, this.cfg.fps) : 1;
        this._stepFrame?.(sign * stepFrames);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault(); e.stopImmediatePropagation();
        this._undo?.();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && (e.key === "Z" || e.key === "z")))) {
        e.preventDefault(); e.stopImmediatePropagation();
        this._redo?.();
      }
    };
    window.addEventListener("keydown", this._keyHandler, true);
  }

  /**
   * Build the image/audio source row inside the topOptionsBar. Each side
   * has an upload button (icon-only) + a status label that reflects the
   * current resolved source ("Upstream", "Inline (filename)", or
   * "not loaded"). Clicking the upload button opens the file picker;
   * uploading sets the corresponding cfg fields and auto-disconnects the
   * matching wire.
   */
  _buildSourceRow(host) {
    host.textContent = "";
    const row = document.createElement("div");
    row.className = "pix-as-source-row";

    // Image upload + status
    const imgCell = document.createElement("div");
    imgCell.className = "pix-as-source-cell";
    const imgBtn = createButton("Upload Image", {
      variant: "standard",
      iconSrc: UI_ICON + "image.svg",
      title: "Upload an image (auto-disconnects upstream IMAGE wire)",
      onClick: () => this._pickInlineImage(),
    });
    const imgStatus = document.createElement("span");
    imgStatus.className = "pix-as-source-cell-status";
    imgStatus.textContent = "—";
    imgCell.append(imgBtn, imgStatus);
    this.imgPill = imgStatus;   // legacy name still used by source resolution

    // Divider
    const sep = document.createElement("div");
    sep.className = "pix-as-source-divider";

    // Audio upload + status
    const audCell = document.createElement("div");
    audCell.className = "pix-as-source-cell";
    const audBtn = createButton("Upload Audio", {
      variant: "standard",
      iconSrc: UI_ICON + "audio.svg",
      title: "Upload audio (auto-disconnects upstream AUDIO wire). MP3 / OGG / etc. converted to WAV.",
      onClick: () => this._pickInlineAudio(),
    });
    const audStatus = document.createElement("span");
    audStatus.className = "pix-as-source-cell-status";
    audStatus.textContent = "—";
    audCell.append(audBtn, audStatus);
    this.audioPill = audStatus;

    // RAM-need pill (pinned to far right via margin:auto). Shows the live
    // estimate for the current settings + how much RAM the system has free,
    // so users see the same number the engine will use BEFORE pressing Run.
    const memCell = document.createElement("div");
    memCell.className = "pix-as-mem-pill";
    memCell.title = "Estimated system RAM the render will need with current "
                  + "settings, vs RAM currently free on this machine. Lower "
                  + "fps, shorten the audio, or reduce resolution to shrink.";
    const memNeedLabel = document.createElement("span");
    memNeedLabel.className = "label";
    memNeedLabel.textContent = "RAM needed:";
    const memNeedValue = document.createElement("span");
    memNeedValue.className = "value";
    memNeedValue.textContent = "—";
    const memSep = document.createElement("span");
    memSep.className = "sep";
    memSep.textContent = "·";
    const memFreeLabel = document.createElement("span");
    memFreeLabel.className = "label";
    memFreeLabel.textContent = "Free:";
    const memFreeValue = document.createElement("span");
    memFreeValue.className = "value";
    memFreeValue.textContent = "—";
    memCell.append(memNeedLabel, memNeedValue, memSep, memFreeLabel, memFreeValue);
    this._memPill = { root: memCell, need: memNeedValue, free: memFreeValue };

    row.append(imgCell, sep, audCell, memCell);
    host.appendChild(row);
  }

  /**
   * Recompute the "RAM needed / Free" pill from current cfg + loaded sources.
   * Cheap (one fps × W × H × duration multiplication) — safe to call from
   * every cfg change. The cap value comes from a once-per-open server fetch.
   *
   * The math mirrors generate_video()'s output tensor: total_frames × H × W
   * × 3 × 4 bytes (float32 RGB). Aspect-ratio + mult-of-8 snapping matches
   * process_aspect() so the estimate is what the engine will actually
   * allocate.
   */
  _refreshMemPill() {
    if (!this._memPill) return;
    const pill = this._memPill;
    const fps = this.cfg.fps || 24;
    const duration = this._audioBuffer ? this._audioBuffer.duration : 0;
    const totalFrames = Math.floor(duration * fps);
    let w = 0, h = 0;
    const eff = computeEngineWH(
      this.cfg.aspect_ratio || "Original",
      this.cfg.custom_width || 1024,
      this.cfg.custom_height || 1024,
    );
    if (eff) {
      w = eff.w; h = eff.h;
    } else {
      // "Original" aspect — use loaded image dims, snapped to mult-of-8
      // (matches process_aspect's snap).
      w = Math.floor((this._imageW || 0) / 8) * 8;
      h = Math.floor((this._imageH || 0) / 8) * 8;
    }
    const estBytes = (totalFrames > 0 && w > 0 && h > 0)
      ? totalFrames * w * h * 3 * 4 : 0;
    const estGb = estBytes / (1024 ** 3);
    const sys = this._sysinfo || {};
    const freeGb = sys.available_gb;
    const capGb  = sys.cap_gb;

    pill.need.textContent = estGb > 0
      ? `${estGb < 10 ? estGb.toFixed(2) : estGb.toFixed(1)} GB`
      : "—";
    pill.free.textContent = (freeGb != null)
      ? `${freeGb < 10 ? freeGb.toFixed(1) : freeGb.toFixed(0)} GB`
      : "—";

    pill.root.classList.remove("ok", "warn", "err");
    if (estGb > 0 && capGb != null) {
      if (estGb > capGb)              pill.root.classList.add("err");
      else if (estGb > capGb * 0.75)  pill.root.classList.add("warn");
      else                            pill.root.classList.add("ok");
    }
  }

  /**
   * Fetch system RAM once per editor open and cache on the instance. Then
   * paint the pill. Safe if psutil isn't available server-side — fields
   * come back null and the pill just hides the Free / cap colouring.
   */
  async _initSysInfo() {
    try {
      this._sysinfo = await getSysInfo();
    } catch {
      this._sysinfo = { total_gb: null, available_gb: null, cap_gb: null };
    }
    this._refreshMemPill();
  }

  _refreshSaveBtnState() {
    // Save button always stays clickable - if there are no changes, Save
    // just closes the editor cleanly (see _save below). A greyed-out Save
    // that no-ops on click is more confusing than a Save that always does
    // the obvious thing. The .disabled class is still toggled for a subtle
    // visual hint that nothing needs persisting, but the button itself is
    // never functionally disabled.
    const dirty = this.isDirty();
    const btn = this._layout?.saveBtn;
    if (!btn) return;
    btn.disabled = false;
    btn.classList.toggle("disabled", !dirty);
  }

  /**
   * Refresh the framework's undo/redo button enabled state. Called after
   * every edit / undo / redo.
   */
  _refreshUndoButtonsState() {
    this._layout?.setUndoState({
      canUndo: this._undoStack.length > 0,
      canRedo: this._redoStack.length > 0,
    });
  }

  _save() {
    // No edits to persist? Just close cleanly. Users instinctively reach
    // for Save as the "I'm done here" button even when they only opened
    // the editor to look; a no-op click feels like the editor is broken.
    if (!this.isDirty()) {
      this.forceClose();
      return;
    }
    // Commit any wire disconnects that were queued by inline uploads during
    // the session. Deferring to save time means a Discard close leaves the
    // upstream wire intact — uploads only affect the graph if the user
    // confirms with Save.
    if (this._pendingDisconnects && this._pendingDisconnects.size) {
      for (const name of this._pendingDisconnects) {
        this._disconnectUpstreamInput(name);
      }
      this._pendingDisconnects.clear();
    }
    // Auto-clear force_inline at save time when no upstream is wired for
    // that channel. After the disconnects above this is almost always the
    // case for channels the user uploaded inline. The override flag only
    // matters while a wire is present; clearing it lets "wire it later"
    // work without forcing the user to re-open the editor.
    const upstreamImg = !!getUpstreamImageUrl(app.graph, this.node);
    const audioInputIdx = (this.node.inputs || []).findIndex((i) => i.name === "audio");
    const upstreamAud = audioInputIdx >= 0 && this.node.inputs[audioInputIdx].link != null;
    if (!upstreamImg) this.cfg.image_force_inline = false;
    if (!upstreamAud) this.cfg.audio_force_inline = false;
    this.onSave?.(JSON.parse(JSON.stringify(this.cfg)));
    this.savedSnapshot = JSON.stringify(this.cfg);
    this._uploadDirty = false;
    this._refreshSaveBtnState();
    this.close();
  }

  _onCfgChanged() {
    // Snap for undo BEFORE other side-effects so Ctrl+Z restores to the
    // pre-change state. Debounced (200ms) so dragging a slider doesn't
    // flood the stack — only the settled value is captured.
    this._snapForUndo(false);
    this._refreshSaveBtnState();
    this._refreshMemPill();
    // Only recompute audio when an analysis-affecting param changed. The
    // FFT + 4-band envelope on a 60s clip is ~6k samples per band; running
    // it on every tick made the smoothing slider feel sticky in particular,
    // because each tick of the slider re-ran the full bandpass + envelope.
    // Debouncing 200ms means the work runs once after the slider settles.
    // audio_band is just a uniform read by the shader, doesn't re-analyse.
    if (this._audioBuffer) {
      const key = `${this.cfg.fps}|${this.cfg.smoothing}|${this.cfg.loop_safe}`;
      if (key !== this._audioParamsKey) this._scheduleRecomputeAudio();
    }
    this._render?.();
  }

  /**
   * Debounced wrapper around _recomputeAudio — collapses bursts of
   * fps / smoothing / loop_safe slider ticks into one analysis pass after
   * the user stops dragging. 200ms matches the undo-snap debounce so a
   * settled drag triggers exactly one recompute and one undo entry.
   */
  _scheduleRecomputeAudio() {
    if (this._recomputeTimer) clearTimeout(this._recomputeTimer);
    this._recomputeTimer = setTimeout(() => {
      this._recomputeTimer = null;
      this._recomputeAudio();
    }, 200);
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
      this._refreshUndoButtonsState();
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
    this._refreshUndoButtonsState();
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
      <h3>Unsaved changes</h3>
      <p>Close the AudioReact without saving? Your edits will be lost.</p>
      <div class="pix-as-confirm-actions">
        <button class="pix-as-btn pix-as-btn-cancel">Keep editing</button>
        <button class="pix-as-btn pix-as-btn-discard">Discard &amp; close</button>
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

  // Is this editor's overlay still in the document? Used by the self-healing
  // loadGraphData/configure patches to detect a teardown that bypassed
  // forceClose (Vue Compat #2).
  _overlayAlive() {
    return !!(this.overlay && this.overlay.isConnected);
  }

  // Restore the graph patches we installed in open(). Idempotent + safe to
  // call from BOTH forceClose AND the self-heal path.
  _restoreGraphPatches() {
    if (this._undoGuardOff) { this._undoGuardOff(); this._undoGuardOff = null; }
  }

  forceClose() {
    // Restore Vue-compat patches
    this._restoreGraphPatches();
    if (this._keyHandler) {
      window.removeEventListener("keydown", this._keyHandler, true);
      this._keyHandler = null;
    }
    // Stop any active playback + detach window-level scrub listeners
    // before the overlay leaves the DOM (otherwise they leak the closure
    // back into a removed overlay).
    this._pausePlayback?.();
    this._detachTransportListeners?.();
    // Cancel any in-flight debounced timers.
    if (this._recomputeTimer) { clearTimeout(this._recomputeTimer); this._recomputeTimer = null; }
    if (this._snapTimer)      { clearTimeout(this._snapTimer);      this._snapTimer = null; }
    // Restore node.onConnectionsChange.
    if (this._origOnConnectionsChange !== undefined) {
      this.node.onConnectionsChange = this._origOnConnectionsChange;
      this._origOnConnectionsChange = undefined;
    }
    // Tear down GL before the overlay leaves the DOM.
    this._destroyRenderer?.();
    // Framework unmount removes the overlay and runs onCleanup.
    if (this._layout) {
      try { this._layout.unmount(); } catch {}
      this._layout = null;
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
  this._refreshMemPill?.();
};

// ---------------------------------------------------------------------------
// Source resolution (H1 + H2)
//
// Both image and audio support two sources: "upstream" (walk node.inputs[].link
// to a Load Image / Load Audio node) and "inline" (file uploaded by the user
// via the source pill picker or drag-drop, served from input/pixaroma/...).
// Pill click toggles between them; if upstream isn't wired, click opens the
// file picker.
// ---------------------------------------------------------------------------

AudioStudioEditor.prototype._showCanvasMessage = function (msg) {
  // Replaces the canvas with a text message — used when source resolution
  // can't produce something to render. _setImage clears this back automatically.
  this.canvasHost.textContent = msg;
};

/**
 * Mark `inputName` ("image" or "audio") to be disconnected from its upstream
 * wire when the user clicks Save. Called from the inline-upload paths so an
 * upload doesn't permanently mutate the graph until the user confirms; if
 * they Discard the editor instead, the queued disconnect is thrown away
 * along with the editor instance.
 */
AudioStudioEditor.prototype._queueWireDisconnect = function (inputName) {
  if (!this._pendingDisconnects) this._pendingDisconnects = new Set();
  this._pendingDisconnects.add(inputName);
};

/**
 * Disconnect the upstream wire feeding `inputName` ("image" or "audio").
 * No-op if nothing is wired. Called from _save() to commit disconnects
 * queued by inline uploads earlier in the editor session.
 */
AudioStudioEditor.prototype._disconnectUpstreamInput = function (inputName) {
  const idx = (this.node.inputs || []).findIndex((i) => i.name === inputName);
  if (idx < 0) return;
  if (this.node.inputs[idx].link == null) return;
  // LiteGraph's standard disconnect API. Triggers onConnectionsChange,
  // which the editor's handler re-resolves the affected source for —
  // harmless here since we're called from _save() right before close.
  try { this.node.disconnectInput(idx); } catch (e) {
    console.warn(`[Pixaroma] AudioReact: disconnectInput(${inputName}) failed:`, e);
  }
};

AudioStudioEditor.prototype._updatePill = function (pillEl, text, connected) {
  pillEl.textContent = text;
  pillEl.classList.toggle("connected", connected);
};

AudioStudioEditor.prototype._loadImageFromUrl = function (url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => { this._setImage(img); resolve(); };
    img.onerror = () => { this._showCanvasMessage("Image load failed: " + url); reject(); };
    img.src = url;
  });
};

AudioStudioEditor.prototype._resolveImageSource = async function () {
  // Priority:
  //   1. force_inline + image_path  -> inline (explicit user override)
  //   2. upstream wired             -> upstream
  //   3. image_path                  -> inline (fallback when no wire)
  //   4. else                        -> "not loaded" message
  //
  // force_inline is set when the user explicitly picks a file in the editor
  // while upstream is wired — that fresh user action overrides the wire.
  // Click the pill while in override mode to clear the flag and revert to
  // upstream.
  const upstreamUrl = getUpstreamImageUrl(app.graph, this.node);
  const wired = !!upstreamUrl;
  const fname = this.cfg.image_path ? this.cfg.image_path.split("/").pop() : "";

  if (this.cfg.image_force_inline && this.cfg.image_path) {
    const url = getInlineSourceUrl(this.cfg.image_path);
    try {
      await this._loadImageFromUrl(url);
      this._updatePill(
        this.imgPill,
        wired ? `Image: Inline override (${fname})` : `Image: Inline (${fname})`,
        false,
      );
      return;
    } catch {}
  }
  if (upstreamUrl) {
    try {
      await this._loadImageFromUrl(upstreamUrl);
      this._updatePill(this.imgPill, "Image: Upstream", true);
      return;
    } catch {}
  }
  if (this.cfg.image_path) {
    const url = getInlineSourceUrl(this.cfg.image_path);
    try {
      await this._loadImageFromUrl(url);
      this._updatePill(this.imgPill, `Image: Inline (${fname})`, false);
      return;
    } catch {}
  }
  this._showCanvasMessage(
    "No image — wire an IMAGE input or click the Image pill to load inline.",
  );
  this._updatePill(this.imgPill, "Image: not loaded", false);
};

AudioStudioEditor.prototype._pickInlineImage = function () {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/png,image/jpeg,image/webp";
  inp.addEventListener("change", async () => {
    const file = inp.files?.[0];
    if (!file) return;
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const filename = `image.${ext === "jpg" ? "jpg" : ext}`;
      const { path } = await uploadSource(this.node.id, "image", file, filename);
      this.cfg.image_source = "inline";
      this.cfg.image_path = path;
      // force_inline=true makes the inline upload win over a still-attached
      // upstream wire during the session preview. The wire isn't physically
      // disconnected until Save (see _queueWireDisconnect + _save) so a
      // Discard leaves the graph untouched.
      this.cfg.image_force_inline = true;
      // Bump upload timestamp so studio_json differs from the previous
      // run even when the file path is identical (same node id + same
      // extension overwrites in place). Without this, ComfyUI's prompt
      // cache hits the prior result and shows the old MP4 unchanged.
      this.cfg.image_uploaded_at = Date.now();
      this._uploadDirty = true;   // bytes-on-disk changed even if path matches
      // Queue (don't immediately apply) the upstream wire disconnect. It
      // commits in _save(); discarded if the user cancels the editor.
      this._queueWireDisconnect("image");
      this._snapForUndo(true);
      this._refreshSaveBtnState();
      await this._resolveImageSource();
    } catch (e) {
      alert("Image upload failed: " + e.message);
    }
  });
  inp.click();
};

AudioStudioEditor.prototype._onImagePillClick = function () {
  // Click always opens the file picker. Uploading auto-disconnects any
  // upstream wire so the graph state is unambiguous (one source at a
  // time). To use upstream instead of the inline pick, re-wire the
  // IMAGE input externally.
  this._pickInlineImage();
};

// --- Audio source resolution (H2) ---

AudioStudioEditor.prototype._resolveAudioSource = async function () {
  // Same priority as image — see _resolveImageSource for the rationale.
  // 1. force_inline + audio_path  -> inline (explicit user override)
  // 2. upstream wired             -> upstream
  // 3. audio_path                  -> inline (fallback)
  // 4. else                        -> "not loaded"
  const audioInputIdx = (this.node.inputs || []).findIndex((i) => i.name === "audio");
  let upstreamUrl = null;
  if (audioInputIdx >= 0) {
    const inp = this.node.inputs[audioInputIdx];
    if (inp.link != null) {
      // graph.links may be Map or plain object (CLAUDE.md Vue point #3)
      let l = app.graph.links?.[inp.link];
      if (!l && typeof app.graph.links?.get === "function") l = app.graph.links.get(inp.link);
      if (l) {
        const src = app.graph.getNodeById(l.origin_id);
        if (src) {
          const w = src.widgets?.find((w) => w.name === "audio" || w.name === "audio_file");
          if (w && w.value) {
            const fn = String(w.value).split(/[\\/]/).pop();
            upstreamUrl = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=&t=${Date.now()}`;
          }
        }
      }
    }
  }
  const wired = !!upstreamUrl;
  const fname = this.cfg.audio_path ? this.cfg.audio_path.split("/").pop() : "";

  if (this.cfg.audio_force_inline && this.cfg.audio_path) {
    try {
      const r = await fetch(getInlineSourceUrl(this.cfg.audio_path));
      const blob = await r.blob();
      await this.loadAudioBlob(blob);
      this._updatePill(
        this.audioPill,
        wired ? `Audio: Inline override (${fname})` : `Audio: Inline (${fname})`,
        false,
      );
      return;
    } catch (e) {
      console.warn("[Pixaroma] AudioReact inline-override fetch failed:", e);
    }
  }
  if (upstreamUrl) {
    try {
      const r = await fetch(upstreamUrl);
      const blob = await r.blob();
      await this.loadAudioBlob(blob);
      this._updatePill(this.audioPill, "Audio: Upstream", true);
      return;
    } catch (e) {
      console.warn("[Pixaroma] AudioReact upstream audio fetch failed, falling back to inline if available:", e);
    }
  }
  if (this.cfg.audio_path) {
    try {
      const r = await fetch(getInlineSourceUrl(this.cfg.audio_path));
      const blob = await r.blob();
      await this.loadAudioBlob(blob);
      this._updatePill(this.audioPill, `Audio: Inline (${fname})`, false);
      return;
    } catch (e) {
      console.warn("[Pixaroma] AudioReact inline audio fetch failed:", e);
    }
  }
  this._updatePill(this.audioPill, "Audio: not loaded", false);
};

/**
 * Convert any audio file to WAV (browser decode → encodeWav from F1) then
 * upload as inline source. Server only accepts WAV — Python decode side
 * stays dependency-free (stdlib `wave`).
 */
AudioStudioEditor.prototype._handleAudioFile = async function (file) {
  let wavBlob;
  if (file.type === "audio/wav" || /\.wav$/i.test(file.name)) {
    wavBlob = file;
  } else {
    try {
      const ab = await file.arrayBuffer();
      const buf = await getAudioContext().decodeAudioData(ab.slice(0));
      wavBlob = encodeWav(buf);
    } catch (e) {
      alert("Could not decode audio: " + e.message);
      return;
    }
  }
  try {
    const { path } = await uploadSource(this.node.id, "audio", wavBlob, "audio.wav");
    this.cfg.audio_source = "inline";
    this.cfg.audio_path = path;
    // force_inline=true: same rationale as image upload — the inline file
    // wins over a still-attached upstream wire during the session, but
    // the wire is only physically disconnected on Save.
    this.cfg.audio_force_inline = true;
    // Bump upload timestamp so studio_json differs from the previous run
    // even when the file path is identical. See the image upload comment.
    this.cfg.audio_uploaded_at = Date.now();
    this._uploadDirty = true;
    // Queue the upstream wire disconnect — applied in _save(), discarded
    // if the user cancels.
    this._queueWireDisconnect("audio");
    this._snapForUndo(true);
    this._refreshSaveBtnState();
    await this._resolveAudioSource();
  } catch (e) {
    alert("Audio upload failed: " + e.message);
  }
};

AudioStudioEditor.prototype._pickInlineAudio = function () {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "audio/*";
  inp.addEventListener("change", async () => {
    const file = inp.files?.[0];
    if (!file) return;
    await this._handleAudioFile(file);
  });
  inp.click();
};

AudioStudioEditor.prototype._onAudioPillClick = function () {
  // Click always opens the file picker — see _onImagePillClick.
  this._pickInlineAudio();
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
  // Stamp the params key so _onCfgChanged can short-circuit when no
  // analysis-affecting param changed since the last compute.
  this._audioParamsKey = `${this.cfg.fps}|${this.cfg.smoothing}|${this.cfg.loop_safe}`;
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
