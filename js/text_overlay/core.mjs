// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay Editor (fullscreen overlay class)              ║
// ║  Shell + lifecycle + render loop. Interactions are mixed in  ║
// ║  via prototype methods in interaction.mjs (side-effect import). ║
// ╚═══════════════════════════════════════════════════════════════╝

import { createEditorLayout } from "../framework/layout.mjs";
import { createTextEditorPanel } from "../framework/text_editor.mjs";
import { renderTextLayer } from "../framework/text_render.mjs";
import { saveThumbnail, buildPreviewURL } from "./api.mjs";

const HELP_HTML = `
  <div><strong>Editing</strong><br/>
  Click a text layer to select it. Drag the bbox to move, drag corners to resize, drag the round handle above to rotate.<br/><br/>
  <strong>Shortcuts</strong><br/>
  Double-click empty canvas - add new text layer<br/>
  Arrow keys - nudge selected layer by 1 px (Shift = 10 px)<br/>
  Delete / Backspace - remove selected layer<br/>
  Hold Shift during rotation - snap to 15 degree increments<br/>
  Hold Alt during corner drag - scale from center<br/>
  Ctrl+Z / Ctrl+Shift+Z - undo / redo
  </div>
`;

export class TextOverlayEditor {
  constructor(node) {
    this.node = node;
    this.layers = [];
    this.selectedIndex = -1;
    this.canvasWidth = 1024;
    this.canvasHeight = 1024;
    this.bgColor = "#000000";
    this.baseImage = null;
    this.undoStack = [];
    this.redoStack = [];
    this._zoom = 1;
    this._closed = false;
    this._renderQueued = false;
  }

  async open() {
    // Vue Compat #6: neuter loadGraphData + graph.configure to block Ctrl+Z escape
    const app = window.app;
    this._savedLoadGraphData = app.loadGraphData.bind(app);
    app.loadGraphData = () => Promise.resolve();
    this._savedGraphConfigure = app.graph.configure.bind(app.graph);
    app.graph.configure = () => {};

    // Resurrection-close safety net (Vue Compat #6)
    this._origOnRemoved = this.node.onRemoved;
    this.node.onRemoved = (...args) => {
      try { this.close(); } catch {}
      return this._origOnRemoved?.apply(this.node, args);
    };

    this.layout = createEditorLayout({
      editorName: "Text Overlay",
      editorId: "pix-text-overlay-editor",
      leftWidth: 240,
      rightWidth: 300,
      showUndoRedo: true,
      showZoomBar: true,
      helpContent: HELP_HTML,
      onSave: () => this.save().catch((e) => this.layout.setSaveError(e.message)),
      onClose: () => this.close(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onZoomIn: () => this.zoomBy(1.25),
      onZoomOut: () => this.zoomBy(0.8),
      onZoomFit: () => this.zoomFit(),
    });
    this.layout.mount();

    // Load saved state
    const state = this.node.properties?.textOverlayState || {};
    this.layers = (state.layers || []).map((l) => ({ ...l }));
    this.canvasWidth = state.canvasWidth || this.widgetValue("width", 1024);
    this.canvasHeight = state.canvasHeight || this.widgetValue("height", 1024);
    this.bgColor = state.bgColor || this.widgetValue("bg_color", "#000000");

    // Try upstream image
    this.baseImage = await this._tryLoadUpstreamImage();
    if (this.baseImage) {
      this.canvasWidth = this.baseImage.naturalWidth;
      this.canvasHeight = this.baseImage.naturalHeight;
    }

    this._buildCanvas();
    this._buildLayersPanel();

    // Text editor panel above the framework's sidebar footer
    this.textEditorMount = document.createElement("div");
    this.textEditorMount.style.cssText = "padding:12px; overflow-y:auto; flex:1;";
    this.layout.rightSidebar.insertBefore(this.textEditorMount, this.layout.sidebarFooter);
    this.textPanel = createTextEditorPanel({
      mount: this.textEditorMount,
      onChange: () => {
        this._snapshotMaybe();
        this._rebuildLayersPanel(); // text could change → rename row
        this.requestRender();
      },
    });
    this._syncLayerSelection();

    // Mix-in installs interaction handlers (mouse + keyboard)
    if (typeof this._installInteractions === "function") this._installInteractions();

    this.requestRender();
    this.zoomFit();
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    if (typeof this._uninstallInteractions === "function") this._uninstallInteractions();
    if (this._savedLoadGraphData) window.app.loadGraphData = this._savedLoadGraphData;
    if (this._savedGraphConfigure) window.app.graph.configure = this._savedGraphConfigure;
    if (this._origOnRemoved !== undefined) this.node.onRemoved = this._origOnRemoved;
    this.textPanel?.destroy?.();
    this.layout?.unmount?.();
    this.node._textOverlayEditor = null;
  }

  async save() {
    this.layout.setSaving();
    const canvas = await this._renderFull();
    const thumb = this._makeThumbnail(canvas, 256);
    const dataURL = thumb.toDataURL("image/png");
    let previewUrl = "";
    try {
      const result = await saveThumbnail(dataURL, `text_overlay_${this.node.id || "n"}`);
      previewUrl = buildPreviewURL(result);
    } catch (e) {
      console.warn("[Text Overlay] thumbnail save failed", e);
      // continue with empty previewUrl; node will just not show a thumb
    }
    this.node.properties.textOverlayState = {
      version: 1,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      bgColor: this.bgColor,
      layers: this.layers,
      previewUrl,
    };
    this.node.setDirtyCanvas?.(true, true);
    this.layout.setSaved(true);
  }

  undo() { this._restoreFromStack(this.undoStack, this.redoStack); }
  redo() { this._restoreFromStack(this.redoStack, this.undoStack); }
  _restoreFromStack(from, to) {
    if (!from.length) return;
    const snap = from.pop();
    to.push(JSON.stringify({ layers: this.layers, selectedIndex: this.selectedIndex }));
    const parsed = JSON.parse(snap);
    this.layers = parsed.layers;
    this.selectedIndex = parsed.selectedIndex;
    this._syncLayerSelection();
    this._rebuildLayersPanel();
    this.requestRender();
  }
  _snapshotMaybe() {
    this.undoStack.push(JSON.stringify({ layers: this.layers, selectedIndex: this.selectedIndex }));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  // ── Canvas ──
  _buildCanvas() {
    const ws = this.layout.workspace;
    this.canvasHost = document.createElement("div");
    this.canvasHost.style.cssText = "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; overflow:auto;";
    ws.appendChild(this.canvasHost);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
    this.canvas.style.cssText = "background:#222; box-shadow:0 0 0 1px #444, 0 0 30px rgba(0,0,0,0.5); transform-origin:center;";
    this.canvasHost.appendChild(this.canvas);
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

  // ── Layers panel ──
  _buildLayersPanel() {
    const root = document.createElement("div");
    root.style.cssText = "padding:12px; color:#fff; font:13px system-ui;";
    this.layersPanelRoot = root;

    const header = document.createElement("div");
    header.style.cssText = "font:600 11px system-ui; color:#888; letter-spacing:1px; margin-bottom:10px;";
    header.textContent = "LAYERS";
    root.appendChild(header);

    this.layersList = document.createElement("div");
    root.appendChild(this.layersList);

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add text layer";
    addBtn.style.cssText = "width:100%; background:#2a2a2a; color:#f66744; border:1px dashed #f66744; padding:8px; border-radius:4px; font:600 11px system-ui; cursor:pointer; margin-top:8px;";
    addBtn.addEventListener("click", () => this.addLayer({ x: this.canvasWidth / 2 - 100, y: this.canvasHeight / 2 - 20 }));
    root.appendChild(addBtn);

    this.layout.leftSidebar.appendChild(root);
    this._rebuildLayersPanel();
  }

  _rebuildLayersPanel() {
    this.layersList.innerHTML = "";
    this.layers.forEach((layer, i) => {
      const row = document.createElement("div");
      const isSel = i === this.selectedIndex;
      row.style.cssText = `background:${isSel ? "#2a1f1a" : "#1d1d1d"}; border:1px solid ${isSel ? "#f66744" : "transparent"}; border-radius:4px; padding:8px; margin-bottom:6px; display:flex; align-items:center; gap:8px; cursor:pointer; ${layer.visible === false ? "opacity:0.5;" : ""}`;

      const eye = document.createElement("div");
      eye.textContent = layer.visible === false ? "⊘" : "👁";
      eye.style.cssText = "cursor:pointer; user-select:none;";
      eye.addEventListener("click", (e) => {
        e.stopPropagation();
        layer.visible = layer.visible === false ? true : false;
        this._snapshotMaybe();
        this._rebuildLayersPanel();
        this.requestRender();
      });
      row.appendChild(eye);

      const name = document.createElement("div");
      name.style.cssText = "flex:1; color:#fff; font:12px system-ui; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
      name.textContent = (layer.text || "(empty)").split("\n")[0].slice(0, 24) || "(empty)";
      row.appendChild(name);

      row.addEventListener("click", () => {
        this.selectedIndex = i;
        this._syncLayerSelection();
        this._rebuildLayersPanel();
        this.requestRender();
      });
      this.layersList.appendChild(row);
    });
  }

  _syncLayerSelection() {
    const layer = this.layers[this.selectedIndex];
    this.textPanel?.setLayer(layer || null);
  }

  addLayer(opts = {}) {
    const layer = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2),
      visible: true,
      text: "Text",
      font: "Inter",
      weight: 400,
      italic: false,
      fontSize: 36,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: "left",
      color: "#FFFFFF",
      opacity: 1.0,
      x: opts.x ?? 100,
      y: opts.y ?? 100,
      rotation: 0,
    };
    this.layers.push(layer);
    this.selectedIndex = this.layers.length - 1;
    this._snapshotMaybe();
    this._rebuildLayersPanel();
    this._syncLayerSelection();
    this.requestRender();
  }

  deleteSelected() {
    if (this.selectedIndex < 0) return;
    this.layers.splice(this.selectedIndex, 1);
    if (this.selectedIndex >= this.layers.length) this.selectedIndex = this.layers.length - 1;
    this._snapshotMaybe();
    this._rebuildLayersPanel();
    this._syncLayerSelection();
    this.requestRender();
  }

  // ── Render loop ──
  requestRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => { this._renderQueued = false; this._renderNow().catch((e) => console.warn("render failed", e)); });
  }

  async _renderNow() {
    const ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.baseImage) ctx.drawImage(this.baseImage, 0, 0, this.canvas.width, this.canvas.height);
    else { ctx.fillStyle = this.bgColor; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    for (const layer of this.layers) {
      try { await renderTextLayer(ctx, layer); } catch (e) { console.warn("layer render failed", e); }
    }
    if (typeof this._drawSelectionOverlay === "function") this._drawSelectionOverlay(ctx);
  }

  async _renderFull() {
    const c = document.createElement("canvas");
    c.width = this.canvasWidth; c.height = this.canvasHeight;
    const ctx = c.getContext("2d");
    if (this.baseImage) ctx.drawImage(this.baseImage, 0, 0, c.width, c.height);
    else { ctx.fillStyle = this.bgColor; ctx.fillRect(0, 0, c.width, c.height); }
    for (const layer of this.layers) {
      try { await renderTextLayer(ctx, layer); } catch (e) { console.warn("layer render failed", e); }
    }
    return c;
  }

  _makeThumbnail(srcCanvas, maxEdge) {
    const ratio = Math.min(maxEdge / srcCanvas.width, maxEdge / srcCanvas.height, 1);
    const w = Math.max(1, Math.round(srcCanvas.width * ratio));
    const h = Math.max(1, Math.round(srcCanvas.height * ratio));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(srcCanvas, 0, 0, w, h);
    return c;
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
    this.canvas.style.transform = `scale(${this._zoom})`;
    this.layout.setZoomLabel?.(`${Math.round(this._zoom * 100)}%`);
  }

  widgetValue(name, fallback) {
    const w = this.node.widgets?.find((x) => x.name === name);
    return (w?.value ?? fallback);
  }
}
