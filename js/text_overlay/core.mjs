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
  Hold Alt during corner drag - scale from center<br/><br/>
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
    // Vue Compat #6: neuter Ctrl+Z escape
    this._savedLoadGraphData = app.loadGraphData.bind(app);
    app.loadGraphData = () => Promise.resolve();
    this._savedGraphConfigure = app.graph.configure.bind(app.graph);
    app.graph.configure = () => {};

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

    // First-time auto-center: when a fresh node opens for the first time with
    // an upstream image, center the text on the canvas so it fits regardless
    // of aspect ratio. Flag is cleared so subsequent opens respect the saved
    // position.
    if (this.state?._autoCenterPending && this.baseImage && this.state.text) {
      this._autoCenter();
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

  close() {
    if (this._closed) return;
    this._closed = true;
    if (typeof this._uninstallInteractions === "function") this._uninstallInteractions();
    if (this._savedLoadGraphData) window.app.loadGraphData = this._savedLoadGraphData;
    if (this._savedGraphConfigure) window.app.graph.configure = this._savedGraphConfigure;
    if (this._origOnRemoved !== undefined) this.node.onRemoved = this._origOnRemoved;
    this.editorPanel?.destroy?.();
    this.layout?.unmount?.();
    this.node._textOverlayEditor = null;
  }

  save() {
    // State is already on node.properties — nothing to save here. Just
    // sync the node body panel + dirty canvas + close.
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
        this.layout.setStatus("Saved to disk", null);
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
    this.layout.setStatus("Download started", null);
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
    const bbox = this._textBbox(s);
    if (bbox.w <= 0) return;
    const factor = (this.canvasWidth * 0.95) / bbox.w;
    s.fontSize = Math.max(8, Math.round(s.fontSize * factor));
    s.x = Math.round((this.canvasWidth - bbox.w * factor) / 2);
    this._snapshotMaybe();
    this.editorPanel.setLayer(s);
    if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s);
    this.requestRender();
  }

  fitHeight() {
    const s = this.state; if (!s || !s.text) return;
    const bbox = this._textBbox(s);
    if (bbox.h <= 0) return;
    const factor = (this.canvasHeight * 0.95) / bbox.h;
    s.fontSize = Math.max(8, Math.round(s.fontSize * factor));
    s.y = Math.round((this.canvasHeight - bbox.h * factor) / 2);
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
    this.selCanvas.style.cssText = `position:absolute; left:${-pad}px; top:${-pad}px; pointer-events:none;`;
    this.canvasWrap.appendChild(this.selCanvas);
  }

  _showNoImageMessage() {
    const msg = document.createElement("div");
    msg.style.cssText = "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#888; font:13px system-ui; padding:20px; text-align:center;";
    msg.textContent = "Run the workflow once so the upstream image is available, then re-open this editor.";
    this.layout.workspace.appendChild(msg);
  }

  async _tryLoadUpstreamImage() {
    const link = this.node.inputs?.find((i) => i.name === "image")?.link;
    if (!link) return null;
    const graph = window.app.graph;
    let linkObj = graph.links?.[link];
    if (!linkObj && typeof graph.links?.get === "function") linkObj = graph.links.get(link);
    if (!linkObj) return null;
    const upstream = graph.getNodeById(linkObj.origin_id);
    return upstream?.imgs?.[0] || null;
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
    const fam = `Pix-${state.font}${state.italic ? "-Italic" : ""}`;
    ctx.font = `${state.italic ? "italic " : ""}${state.weight || 400} ${state.fontSize}px "${fam}"`;
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
