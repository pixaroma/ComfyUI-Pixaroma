// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay Editor (simplified single-text version)        ║
// ║  Same text_editor.mjs panel is mounted on BOTH the node body ║
// ║  and the editor's right sidebar — they share node.properties ║
// ║  .textOverlayState so changes propagate immediately.         ║
// ╚═══════════════════════════════════════════════════════════════╝

import { createEditorLayout } from "../framework/layout.mjs";
import { createTextEditorPanel } from "../framework/text_editor.mjs";
import { resetStateInPlace } from "./defaults.mjs";
import { renderTextLayer } from "../framework/text_render.mjs";
import { getFontCatalog, resolveFontVariant, loadFontForLayer } from "../framework/fonts.mjs";

const UI_ICON = "/pixaroma/assets/icons/ui/";

const HELP_HTML = `
  <div><strong>Editing</strong><br/>
  Drag the bbox to move, drag corners to scale, drag the round handle above to rotate.<br/>
  Snap guides appear when dragging near canvas center / edges / thirds.<br/><br/>
  <strong>Mouse</strong><br/>
  Mouse wheel - zoom in / out<br/>
  Shift + wheel - resize the text (font size)<br/>
  Hold Shift while dragging - bypass snap<br/>
  Hold Shift during rotation - snap to 15 degree increments<br/>
  Hold Alt during corner drag - scale from opposite corner (default is from center)<br/><br/>
  <strong>Keyboard</strong><br/>
  Arrow keys - nudge by 1 px (Shift = 10 px)<br/>
  Delete / Backspace - clear text<br/>
  Ctrl+Z / Ctrl+Shift+Z - undo / redo
  </div>
`;

export class TextOverlayEditor {
  constructor(node) {
    this.node = node;
    this.canvasWidth = 1024;
    this.canvasHeight = 1024;
    this.baseImage = null;
    this.undoStack = [];
    this.redoStack = [];
    this._zoom = 1;
    this._closed = false;
    this._renderQueued = false;
  }

  /** The single text state — alias for node.properties.textOverlayState. */
  get state() { return this.node.properties.textOverlayState; }
  set state(v) { this.node.properties.textOverlayState = v; }

  async open() {
    const app = window.app;
    // Vue Compat #6: neuter Ctrl+Z escape (changeTracker.undo -> loadGraphData
    // -> graph.configure). Vue Compat #2: the overlay can be torn down WITHOUT
    // our close() running (e.g. closing the workflow tab while the editor is
    // open), which would otherwise leave these two functions disabled forever
    // - the user then can't open OR create ANY workflow until a page refresh
    // (confirmed via console: loadGraphData stuck at "() => Promise.resolve()"
    // with zero overlays in the DOM). So the patched functions SELF-HEAL: the
    // moment they're called while our overlay is gone (or after close), they
    // restore the originals and pass the call through. Ctrl+Z while the editor
    // is genuinely open is still blocked (overlay alive -> return early).
    this._savedLoadGraphData = app.loadGraphData.bind(app);
    this._savedGraphConfigure = app.graph.configure.bind(app.graph);
    const self = this;
    app.loadGraphData = function (...args) {
      if (self._closed || !self._overlayAlive()) {
        self._restoreGraphPatches();
        return window.app.loadGraphData(...args);
      }
      return Promise.resolve();
    };
    app.graph.configure = function (...args) {
      if (self._closed || !self._overlayAlive()) {
        self._restoreGraphPatches();
        return window.app.graph.configure(...args);
      }
      return undefined;
    };

    // Resurrection-close safety net
    this._origOnRemoved = this.node.onRemoved;
    this.node.onRemoved = (...args) => {
      try { this.close(); } catch {}
      return this._origOnRemoved?.apply(this.node, args);
    };

    // Take a snapshot for Cancel restore
    this._cancelSnapshot = JSON.stringify(this.state || {});

    this.layout = createEditorLayout({
      editorName: "Text Overlay",
      editorId: "pix-text-overlay-editor",
      leftWidth: 240,
      rightWidth: 300,
      showUndoRedo: true,
      showZoomBar: true,
      showTopOptionsBar: true,
      helpContent: HELP_HTML,
      onSave: () => this.save(),
      onClose: () => this.close(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onZoomIn: () => this.zoomBy(1.25),
      onZoomOut: () => this.zoomBy(0.8),
      onZoomFit: () => this.zoomFit(),
    });
    this.layout.mount();

    this._buildAlignmentBar();
    this._buildCanvasSettings(); // left sidebar
    this._buildCanvas();          // middle

    // Pre-load the font catalog so _textBbox can resolve the actual
    // variant weight (e.g. Oswald is a static 600-only font; measureText
    // with weight 400 silently falls back to a system font and returns
    // narrower widths than the real renderer). Pre-load the active
    // variant too so measureText finds it the first time _textBbox runs.
    try {
      this._fontCatalog = await getFontCatalog();
      const s = this.state;
      if (s?.font) {
        await loadFontForLayer(s.font, s.weight || 400, !!s.italic);
      }
    } catch (e) {
      console.warn("[Text Overlay] font catalog load failed", e);
    }

    // If the `text` input slot is wired (e.g. Text Pixaroma), the
    // workflow uses that text at render time instead of state.text.
    // The editor preview must show the SAME text the workflow will
    // render, otherwise editor and Save Image disagree. Temporarily
    // override state.text with the wired value for this editor
    // session; restore on save/close so the underlying state.text
    // (the user's panel-set text, used as fallback when wire is
    // detached) stays clean.
    this._wiredTextOverride = this._tryReadWiredText();
    if (this._wiredTextOverride != null) {
      this._origTextBeforeWire = this.state.text;
      this.state.text = this._wiredTextOverride;
    }

    // Try upstream image
    this.baseImage = await this._tryLoadUpstreamImage();
    if (this.baseImage) {
      this.canvasWidth = this.baseImage.naturalWidth;
      this.canvasHeight = this.baseImage.naturalHeight;
      this.canvas.width = this.canvasWidth;
      this.canvas.height = this.canvasHeight;
      this.selCanvas.width = this.canvasWidth + 2 * TextOverlayEditor.SEL_PAD;
      this.selCanvas.height = this.canvasHeight + 2 * TextOverlayEditor.SEL_PAD;
      this.canvasWrap.style.width = this.canvasWidth + "px";
      this.canvasWrap.style.height = this.canvasHeight + "px";
      this._dimsLabel.textContent = `${this.canvasWidth} × ${this.canvasHeight}`;
    } else {
      this._showNoImageMessage();
    }

    // Mount the SAME text_editor.mjs panel in the right sidebar that's also
    // mounted on the node body. They edit the same state object.
    this.textPanelMount = document.createElement("div");
    this.textPanelMount.style.cssText = "padding:12px; overflow-y:auto; flex:1 1 auto; min-height:0;";
    this.layout.rightSidebar.style.display = "flex";
    this.layout.rightSidebar.style.flexDirection = "column";
    this.layout.rightSidebar.insertBefore(this.textPanelMount, this.layout.sidebarFooter);
    this.editorPanel = createTextEditorPanel({
      mount: this.textPanelMount,
      onChange: () => {
        this._snapshotMaybe();
        // Sync the node-body panel (if mounted) so its UI reflects the change
        if (this.node._textOverlayBodyPanel) {
          this.node._textOverlayBodyPanel.setLayer(this.state);
        }
        this.requestRender();
      },
      onReset: (layer) => {
        this._snapshotMaybe();
        resetStateInPlace(layer);
        // Sync the node-body panel + re-frame the editor to the canvas
        if (this.node._textOverlayBodyPanel) {
          this.node._textOverlayBodyPanel.setLayer(this.state);
        }
      },
    });
    this.editorPanel.setLayer(this.state);
    // Set X/Y input ranges to the real canvas dimensions so values
    // typed past 4096 (the default hardcoded max) aren't clipped on
    // larger images. setCanvasBounds expands the range to
    // [-canvasWidth, canvasWidth * 2] so text can be positioned with
    // negative offsets and well past the right edge.
    this.editorPanel.setCanvasBounds?.(this.canvasWidth, this.canvasHeight);

    // Lock the text textarea (in BOTH the editor sidebar and the node
    // body panel) when text input is wired. Visual cue that typing in
    // the textarea is ignored at workflow time.
    if (this._wiredTextOverride != null) {
      this.editorPanel.setTextReadOnly?.(true, "Text input is wired - upstream value is used");
      this.node._textOverlayBodyPanel?.setTextReadOnly?.(true, "Text input is wired - upstream value is used");
    }

    // First-run positioning. If the node body queued a "Position on canvas"
    // intent (_alignPending) while the image dims were unknown, OR this is a
    // fresh node that has never been centered (_autoCenterPending), resolve it
    // now that the editor has the image. Clear BOTH flags so a stale pending
    // value can't override the user's editor edits on the next workflow run
    // (an explicit align choice wins over auto-center, matching Python +
    // the graphToPrompt hook).
    if (this.baseImage && this.state?.text) {
      if (this.state._alignPending) {
        this.alignToCanvas(this.state._alignPending);
      } else if (this.state._autoCenterPending) {
        this._autoCenter();
      }
      delete this.state._alignPending;
      delete this.state._autoCenterPending;
    }

    // Wire Save to Disk
    this.layout.onSaveToDisk = () => this.saveToDisk().catch((e) => {
      console.warn("[Text Overlay] saveToDisk failed", e);
      this.layout.setStatus(`Save to disk failed: ${e.message}`, "error");
    });

    if (typeof this._installInteractions === "function") this._installInteractions();

    this.requestRender();
    this.zoomFit();
  }

  _autoCenter() {
    const s = this.state; if (!s) return;
    const bbox = this._textBbox(s);
    s.x = Math.round((this.canvasWidth - bbox.w) / 2);
    s.y = Math.round((this.canvasHeight - bbox.h) / 2);
    this.editorPanel.setLayer(s);
    if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s);
  }

  // Is this editor's fullscreen overlay still in the document? Used by the
  // self-healing loadGraphData/configure patches to detect a teardown that
  // bypassed close() (Vue Compat #2).
  _overlayAlive() {
    return !!(this.layout && this.layout.overlay && this.layout.overlay.isConnected);
  }

  // Restore the loadGraphData/configure functions we neutered in open().
  // Idempotent + safe to call from BOTH close() and the self-heal path.
  _restoreGraphPatches() {
    const app = window.app;
    if (this._savedLoadGraphData) {
      app.loadGraphData = this._savedLoadGraphData;
      this._savedLoadGraphData = null;
    }
    if (this._savedGraphConfigure) {
      if (app.graph) app.graph.configure = this._savedGraphConfigure;
      this._savedGraphConfigure = null;
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    // Restore the user's panel-set text if we temporarily overrode it
    // with the wired-input value at open. The state stays clean so
    // the next editor session (with the wire detached) shows the
    // user's original text.
    if (this._wiredTextOverride != null && this._origTextBeforeWire !== undefined) {
      this.state.text = this._origTextBeforeWire;
    }
    // Body panel lock stays in place even after the editor closes —
    // it reflects current wiring state, not editor session. The
    // index.js onConnectionsChange handler keeps it in sync.
    if (typeof this._uninstallInteractions === "function") this._uninstallInteractions();
    this._restoreGraphPatches();
    if (this._origOnRemoved !== undefined) this.node.onRemoved = this._origOnRemoved;
    this.editorPanel?.destroy?.();
    this.layout?.unmount?.();
    this.node._textOverlayEditor = null;
  }

  save() {
    // State is already on node.properties — nothing to save here. Just
    // sync the node body panel + dirty canvas. The user runs the
    // workflow manually when they want to see the new render.
    if (this.node._textOverlayBodyPanel) {
      this.node._textOverlayBodyPanel.setLayer(this.state);
    }
    this.node.setDirtyCanvas?.(true, true);
    this.layout.setSaved(true);
  }

  // Cancel restore — called from the red X Close button (onClose → close()
  // path). We restore state from the snapshot taken on open.
  cancelAndRestore() {
    try {
      const snap = JSON.parse(this._cancelSnapshot || "{}");
      this.state = snap;
      if (this.node._textOverlayBodyPanel) {
        this.node._textOverlayBodyPanel.setLayer(this.state);
      }
    } catch {}
    this.close();
  }

  async saveToDisk() {
    const canvas = await this._renderFull();
    const suggestedName = `text_overlay_${Date.now()}.png`;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
        });
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        if (!this._closed) this.layout.setStatus("Saved to disk", null);
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
        console.warn("[Text Overlay] showSaveFilePicker failed, falling back", e);
      }
    }
    const dataURL = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataURL; a.download = suggestedName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (!this._closed) this.layout.setStatus("Download started", null);
  }

  // ── Undo / Redo ──
  undo() { this._restoreFromStack(this.undoStack, this.redoStack); }
  redo() { this._restoreFromStack(this.redoStack, this.undoStack); }
  _restoreFromStack(from, to) {
    if (!from.length) return;
    const snap = from.pop();
    to.push(JSON.stringify(this.state || {}));
    this.state = JSON.parse(snap);
    this.editorPanel.setLayer(this.state);
    if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(this.state);
    this.requestRender();
  }
  _snapshotMaybe() {
    this.undoStack.push(JSON.stringify(this.state || {}));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  // ── Alignment bar (top options, align text to canvas) ──
  _buildAlignmentBar() {
    if (!this.layout.topOptionsBar) return;
    const bar = this.layout.topOptionsBar;
    bar.style.cssText = "display:flex; align-items:center; justify-content:center; gap:8px; padding:6px 12px; background:#1d1d1d; border-bottom:1px solid #2a2a2a;";
    const label = document.createElement("span");
    label.textContent = "Align to canvas:";
    label.style.cssText = "font:600 11px system-ui; color:#888; letter-spacing:1px; margin-right:6px;";
    bar.appendChild(label);
    const aligns = [
      { id: "left",     icon: "align-left.svg",      title: "Align left" },
      { id: "centerH",  icon: "align-center-h.svg",  title: "Align horizontal center" },
      { id: "right",    icon: "align-right.svg",     title: "Align right" },
      { id: "sep" },
      { id: "top",      icon: "align-top.svg",       title: "Align top" },
      { id: "centerV",  icon: "align-center-v.svg",  title: "Align vertical center" },
      { id: "bottom",   icon: "align-bottom.svg",    title: "Align bottom" },
    ];
    for (const a of aligns) {
      if (!a.icon) {
        const sep = document.createElement("div");
        sep.style.cssText = "width:1px; height:18px; background:#333; margin:0 4px;";
        bar.appendChild(sep); continue;
      }
      const btn = document.createElement("button");
      btn.title = a.title;
      btn.style.cssText = "background:#2a2a2a; border:1px solid #333; border-radius:4px; padding:5px 8px; cursor:pointer; display:flex; align-items:center; justify-content:center;";
      const img = document.createElement("img");
      img.src = UI_ICON + a.icon;
      img.style.cssText = "width:14px; height:14px; filter:invert(0.8);";
      btn.appendChild(img);
      btn.addEventListener("mouseenter", () => { btn.style.borderColor = "#f66744"; img.style.filter = "invert(1)"; });
      btn.addEventListener("mouseleave", () => { btn.style.borderColor = "#333"; img.style.filter = "invert(0.8)"; });
      btn.addEventListener("click", () => this.alignToCanvas(a.id));
      bar.appendChild(btn);
    }
  }

  alignToCanvas(mode) {
    const s = this.state; if (!s || !s.text) return;
    const bbox = this._textBbox(s);
    switch (mode) {
      case "left":    s.x = 0; break;
      case "centerH": s.x = Math.round((this.canvasWidth - bbox.w) / 2); break;
      case "right":   s.x = Math.round(this.canvasWidth - bbox.w); break;
      case "top":     s.y = 0; break;
      case "centerV": s.y = Math.round((this.canvasHeight - bbox.h) / 2); break;
      case "bottom":  s.y = Math.round(this.canvasHeight - bbox.h); break;
    }
    this._snapshotMaybe();
    this.editorPanel.setLayer(s);
    if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s);
    this.requestRender();
  }

  // ── Canvas Settings panel (left sidebar) — dims + Fit W/H ──
  _buildCanvasSettings() {
    const panel = document.createElement("div");
    panel.className = "pxf-panel";
    panel.style.cssText = "margin:8px;";
    panel.innerHTML = `
      <div class="pxf-panel-header">CANVAS</div>
    `;
    const body = document.createElement("div");
    body.style.cssText = "padding:8px 10px; display:flex; flex-direction:column; gap:8px;";

    this._dimsLabel = document.createElement("div");
    this._dimsLabel.style.cssText = "color:#aaa; font:12px system-ui;";
    this._dimsLabel.textContent = `${this.canvasWidth} × ${this.canvasHeight}`;
    body.appendChild(this._dimsLabel);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex; gap:6px;";
    const fitW = document.createElement("button");
    fitW.textContent = "Fit W";
    fitW.style.cssText = "flex:1; background:#2a2a2a; color:#fff; border:1px solid #444; padding:6px; border-radius:4px; font:600 12px system-ui; cursor:pointer;";
    fitW.addEventListener("click", () => this.fitWidth());
    const fitH = document.createElement("button");
    fitH.textContent = "Fit H";
    fitH.style.cssText = fitW.style.cssText;
    fitH.addEventListener("click", () => this.fitHeight());
    btnRow.append(fitW, fitH);
    body.appendChild(btnRow);

    panel.appendChild(body);
    this.layout.leftSidebar.appendChild(panel);
  }

  fitWidth() {
    const s = this.state; if (!s || !s.text) return;
    // Direct calculation: font scales the text width linearly, the bg
    // pad is fixed. Solve for the font size that lands bbox.w at 95% of
    // canvas width. Iteration was hitting early-exits (rounding +
    // tolerance) so a single direct calculation is more reliable.
    const padX = s.bgColor ? 16 : 0;
    const target = this.canvasWidth * 0.95;
    const targetTextW = Math.max(1, target - 2 * padX);
    const bbox = this._textBbox(s);
    const currentTextW = Math.max(1, bbox.w - 2 * padX);
    const newSize = Math.max(8, Math.min(512, Math.round(s.fontSize * targetTextW / currentTextW)));
    s.fontSize = newSize;
    // Center horizontally with the NEW measured bbox (after the font
    // size change, the text width is different).
    const finalBbox = this._textBbox(s);
    s.x = Math.round((this.canvasWidth - finalBbox.w) / 2);
    this._snapshotMaybe();
    this.editorPanel.setLayer(s);
    if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s);
    this.requestRender();
  }

  fitHeight() {
    const s = this.state; if (!s || !s.text) return;
    const padY = s.bgColor ? 10 : 0;
    const target = this.canvasHeight * 0.95;
    const targetTextH = Math.max(1, target - 2 * padY);
    const bbox = this._textBbox(s);
    const currentTextH = Math.max(1, bbox.h - 2 * padY);
    const newSize = Math.max(8, Math.min(512, Math.round(s.fontSize * targetTextH / currentTextH)));
    s.fontSize = newSize;
    const finalBbox = this._textBbox(s);
    s.y = Math.round((this.canvasHeight - finalBbox.h) / 2);
    this._snapshotMaybe();
    this.editorPanel.setLayer(s);
    if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s);
    this.requestRender();
  }

  // ── Canvas (image + selection overlay) ──
  static SEL_PAD = 200;

  _buildCanvas() {
    const ws = this.layout.workspace;
    this.canvasHost = document.createElement("div");
    this.canvasHost.style.cssText = "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; overflow:auto;";
    ws.appendChild(this.canvasHost);

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.style.cssText = `position:relative; width:${this.canvasWidth}px; height:${this.canvasHeight}px; transform-origin:center;`;
    this.canvasHost.appendChild(this.canvasWrap);

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
    this.canvas.style.cssText = "background:#222; box-shadow:0 0 0 1px #444, 0 0 30px rgba(0,0,0,0.5); position:absolute; left:0; top:0;";
    this.canvasWrap.appendChild(this.canvas);

    const pad = TextOverlayEditor.SEL_PAD;
    this.selCanvas = document.createElement("canvas");
    this.selCanvas.width = this.canvasWidth + 2 * pad;
    this.selCanvas.height = this.canvasHeight + 2 * pad;
    // pointer-events left ON (default) so corner / rotate handles that
    // sit OUTSIDE the visible canvas (when the text is bigger than the
    // canvas, or near an edge) can still be grabbed. SEL_PAD = 200 gives
    // a 200 px catch zone around the canvas in every direction. The
    // selCanvas covers the canvas area too, so all clicks end up here
    // and get routed by _canvasCoords which uses this.canvas's bounding
    // rect as origin (so coordinates outside the canvas come through as
    // negative / past-edge values, exactly what the hit-test needs).
    this.selCanvas.style.cssText = `position:absolute; left:${-pad}px; top:${-pad}px;`;
    this.canvasWrap.appendChild(this.selCanvas);
  }

  _showNoImageMessage() {
    const msg = document.createElement("div");
    msg.style.cssText = "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#888; font:13px system-ui; padding:20px; text-align:center;";
    msg.textContent = "Run the workflow once so the upstream image is available, then re-open this editor.";
    this.layout.workspace.appendChild(msg);
  }

  // Read the text value from whatever node is wired into the `text`
  // input slot. Returns null if not wired, or if the upstream doesn't
  // expose a readable text widget. Covers Text Pixaroma (widget name
  // "text") and any node with a single STRING widget on the standard
  // names (text / string / prompt / value).
  _tryReadWiredText() {
    const link = this.node.inputs?.find((i) => i.name === "text")?.link;
    if (link == null) return null;
    const graph = window.app.graph;
    let linkObj = graph.links?.[link];
    if (!linkObj && typeof graph.links?.get === "function") linkObj = graph.links.get(link);
    if (!linkObj) return null;
    const upstream = graph.getNodeById(linkObj.origin_id);
    if (!upstream) return null;
    const w = upstream.widgets?.find((x) =>
      x && (x.name === "text" || x.name === "string" || x.name === "prompt" || x.name === "value")
    );
    return typeof w?.value === "string" ? w.value : null;
  }

  async _tryLoadUpstreamImage() {
    const link = this.node.inputs?.find((i) => i.name === "image")?.link;
    if (!link) return null;
    const graph = window.app.graph;
    let linkObj = graph.links?.[link];
    if (!linkObj && typeof graph.links?.get === "function") linkObj = graph.links.get(link);
    if (!linkObj) return null;
    const upstream = graph.getNodeById(linkObj.origin_id);
    // Path 1: upstream is a node that populates imgs (Load Image, etc).
    const direct = upstream?.imgs?.[0];
    if (direct && direct.complete && direct.naturalWidth > 0) return direct;
    // Path 2: upstream is intermediate (VAE Decode etc) with no imgs.
    // The Python node stashes the input frame to temp/ on every run and
    // index.js caches the URL on this node as _textOverlayBaseImageURL.
    // Load that as an HTMLImageElement.
    const url = this.node._textOverlayBaseImageURL;
    if (url) {
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.crossOrigin = "anonymous";
          el.onload = () => resolve(el);
          el.onerror = reject;
          el.src = url;
        });
        if (img.naturalWidth > 0) return img;
      } catch (e) {
        console.warn("[Text Overlay] failed to load cached base image", e);
      }
    }
    return null;
  }

  // ── Render loop ──
  requestRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this._renderNow().catch((e) => console.warn("render failed", e));
    });
  }

  async _renderNow() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.baseImage) ctx.drawImage(this.baseImage, 0, 0, this.canvas.width, this.canvas.height);
    if (this.state?.text) {
      try { await renderTextLayer(ctx, this.state); } catch (e) { console.warn("text render failed", e); }
    }
    if (this.selCanvas) {
      const sctx = this.selCanvas.getContext("2d");
      sctx.clearRect(0, 0, this.selCanvas.width, this.selCanvas.height);
      if (typeof this._drawSelectionOverlay === "function") this._drawSelectionOverlay(sctx);
    }
  }

  async _renderFull() {
    const c = document.createElement("canvas");
    c.width = this.canvasWidth; c.height = this.canvasHeight;
    const ctx = c.getContext("2d");
    if (this.baseImage) ctx.drawImage(this.baseImage, 0, 0, c.width, c.height);
    else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height); }
    if (this.state?.text) {
      try { await renderTextLayer(ctx, this.state); } catch (e) { console.warn("text render failed", e); }
    }
    return c;
  }

  // ── Bbox helper (approximate, for hit-test and align) ──
  _textBbox(state) {
    if (!this._measureCtx) {
      const c = document.createElement("canvas"); c.width = 1; c.height = 1;
      this._measureCtx = c.getContext("2d");
    }
    const ctx = this._measureCtx;
    // Resolve the actual loaded variant so measureText uses the SAME font
    // string the renderer uses. Static fonts (Oswald 600 only, Anton 400
    // only, Bebas Neue 400 only) register their FontFace with one specific
    // weight. measureText with a different weight in the font string
    // silently falls back to a default system font, returning narrower
    // widths than the real render — that breaks Fit W / Fit H and any
    // hit-test math. Falls back to state values if catalog isn't loaded yet.
    let weight = state.weight || 400;
    let italic = !!state.italic;
    let fontId = state.font || "Roboto";
    if (this._fontCatalog) {
      try {
        const v = resolveFontVariant(this._fontCatalog, fontId, weight, italic);
        weight = v.weight;
        italic = v.italic;
        fontId = v.fontId;
        // Pre-load the variant for next time _textBbox runs (no-op if cached)
        loadFontForLayer(fontId, weight, italic).catch(() => {});
      } catch {}
    }
    const fam = `Pix-${fontId}${italic ? "-Italic" : ""}`;
    ctx.font = `${italic ? "italic " : ""}${weight} ${state.fontSize}px "${fam}"`;
    const lines = String(state.text ?? "").split("\n");
    const widths = lines.map((ln) => ctx.measureText(ln).width + Math.max(0, ln.length - 1) * (state.letterSpacing || 0));
    const lineHeightPx = Math.round(state.fontSize * (state.lineHeight || 1.2));
    const m = ctx.measureText("Mg");
    const asc = m.actualBoundingBoxAscent || state.fontSize * 0.78;
    const desc = m.actualBoundingBoxDescent || state.fontSize * 0.22;
    let w = Math.max(0, ...widths);
    let h = (asc + desc) + Math.max(0, lines.length - 1) * lineHeightPx;
    if (state.bgColor) {
      w += 2 * 16; // BG_PAD_X
      h += 2 * 10; // BG_PAD_Y
    }
    return { x: state.x, y: state.y, w: Math.max(20, w), h: Math.max(20, h) };
  }

  // ── Zoom ──
  zoomBy(factor) { this._zoom *= factor; this._applyZoom(); }
  zoomFit() {
    const padding = 60;
    const fitX = Math.max(0.05, (this.canvasHost.clientWidth - padding) / this.canvasWidth);
    const fitY = Math.max(0.05, (this.canvasHost.clientHeight - padding) / this.canvasHeight);
    this._zoom = Math.min(fitX, fitY, 1);
    this._applyZoom();
  }
  _applyZoom() {
    if (this.canvasWrap) this.canvasWrap.style.transform = `scale(${this._zoom})`;
    this.layout.setZoomLabel?.(`${Math.round(this._zoom * 100)}%`);
  }

  _focusOverlay() {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      const tag = document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") document.activeElement.blur();
    }
    if (this.layout?.overlay) this.layout.overlay.focus();
  }
}
