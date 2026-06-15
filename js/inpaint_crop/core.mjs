// ============================================================
// Inpaint Crop Pixaroma — Editor core (constructor, open/close, build UI)
// ============================================================
import {
  BRAND,
  createEditorLayout,
  createPanel,
  createButton,
  createPillGrid,
  createSliderRow,
  createInfo,
} from "../framework/index.mjs";
import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";

export { BRAND };
const UI = "/pixaroma/assets/icons/ui/";

export const InpaintAPI = {
  async uploadSrc(projectId, dataURL) {
    const { api } = await import("/scripts/api.js");
    const res = await api.fetchApi("/pixaroma/api/inpaint/upload_src", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, image: dataURL }),
    });
    return await res.json();
  },
  async saveMask(projectId, dataURL) {
    const { api } = await import("/scripts/api.js");
    const res = await api.fetchApi("/pixaroma/api/inpaint/save_mask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, mask: dataURL }),
    });
    return await res.json();
  },
};

export class InpaintCropEditor {
  constructor() {
    this.onSave = null;          // (stateJsonStr, { context_px }, previewDataURL)
    this.onSaveToDisk = null;    // (previewDataURL)
    this.onClose = null;
    this.onLoadImage = null;     // host disconnects the upstream wire
    this.el = {};
    this.layout = null;
    this.img = null;
    this.imgW = 0;
    this.imgH = 0;
    this.projectId = null;
    this._scale = 1;
    this._srcPath = "";
    this._maskPath = "";
    this._pendingSrcDataURL = null;

    // brush / mask state
    this.tool = "add";           // "add" | "erase"
    this.brushSize = 48;         // display px (diameter)
    this.softness = 0.5;         // 0 hard .. 1 soft
    this.maskOpacity = 0.5;
    this.maskVisible = true;
    this._painting = false;
    this._lastPt = null;

    // geometry params (snapshot of the node knobs)
    this.params = {};
    this._bbox = null;           // raw painted bbox (source px)
    this._region = null;         // computeRegion() result

    // undo
    this._undo = [];
    this._redo = [];
  }

  // upstreamUrl: live source from the wired IMAGE input (wins over saved src).
  // params: { size_mode, target, multiple, context_px, mask_grow } (internal keys)
  open(jsonStr, upstreamUrl, params) {
    let data = {};
    try { data = jsonStr && jsonStr !== "{}" ? JSON.parse(jsonStr) : {}; } catch (e) {}

    this.projectId = data.project_id || "inpaint_" + Date.now();
    this._srcPath = data.src_path || "";
    this._maskPath = data.mask_path || "";
    this.params = { ...(params || {}) };
    if (this.params.context_px != null) this.brushContextPx = this.params.context_px;
    this._fromUpstream = !!upstreamUrl;

    this._buildUI();
    this.layout.mount();
    this._undoGuardOff = installGraphUndoGuard(() => !!this.el.overlay?.isConnected);

    let sourceURL = null;
    if (upstreamUrl) sourceURL = upstreamUrl;
    else if (this._srcPath) {
      const fn = this._srcPath.split(/[\\/]/).pop();
      sourceURL = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
    }

    if (sourceURL) {
      this._loadImageFromURL(sourceURL, () => {
        // restore a saved painted mask (best-effort) once the image is sized
        if (this._maskPath) {
          const mfn = this._maskPath.split(/[\\/]/).pop();
          const murl = `/view?filename=${encodeURIComponent(mfn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
          this._loadMaskFromURL(murl);
        }
      });
    } else {
      this._setStatus("No source loaded. Wire an IMAGE input and run the workflow once, or click Load Image.");
    }
    this._bindKeys();
  }

  _close() { this.layout?.unmount(); }

  _buildUI() {
    const layout = createEditorLayout({
      editorName: "Inpaint Crop",
      editorId: "pixaroma-inpaint-editor",
      showUndoRedo: true,
      showZoomBar: false,
      showStatusBar: true,
      onSave: () => this._save(),
      onClose: () => this._close(),
      onUndo: () => this._doUndo(),
      onRedo: () => this._doRedo(),
      helpContent: `
        <b>Paint the mask:</b> drag on the image to mark the area to fix<br>
        <b>Brush / Erase:</b> pick a tool, or press <kbd>B</kbd> / <kbd>E</kbd><br>
        <b>Brush size:</b> <kbd>[</kbd> / <kbd>]</kbd> or the mouse wheel<br>
        <b>Toggle erase:</b> hold <kbd>X</kbd><br>
        <b>Show / hide mask:</b> <kbd>H</kbd><br>
        <b>Invert / Clear:</b> buttons in the sidebar<br>
        <b>Undo / Redo:</b> <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd><br>
        The orange box is the crop that goes to the model. Adjust the context
        margin in the sidebar (or on the node) to include more surroundings.<br>
        <b>Save:</b> <kbd>Ctrl+S</kbd> · <b>Close:</b> <kbd>Escape</kbd>`,
    });
    this.layout = layout;
    layout.onSaveToDisk = () => { this._diskSavePending = true; this._save(); };
    layout.onCleanup = () => {
      if (this._undoGuardOff) { this._undoGuardOff(); this._undoGuardOff = null; }
      this._unbindKeys();
      if (this.onClose) this.onClose();
    };
    this.el.overlay = layout.overlay;
    this.el.workspace = layout.workspace;

    this._buildLeftSidebar(layout.leftSidebar);
    this._buildRightSidebar(layout.rightSidebar, layout.sidebarFooter);

    // canvas stack: main image+mask+overlay, plus a cursor canvas on top
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;display:inline-block;line-height:0;";
    this.el.canvasWrap = wrap;
    const cvs = document.createElement("canvas");
    cvs.width = 100; cvs.height = 100;
    this.el.canvas = cvs;
    this.el.ctx = cvs.getContext("2d");
    const cur = document.createElement("canvas");
    cur.width = 100; cur.height = 100;
    cur.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;";
    this.el.cursor = cur;
    this.el.curCtx = cur.getContext("2d");
    wrap.append(cvs, cur);
    layout.workspace.appendChild(wrap);

    this._bindMouse(cvs);
    layout.setUndoState({ canUndo: false, canRedo: false });
  }

  _buildLeftSidebar(sidebar) {
    // Mask tools
    const secTools = createPanel("Mask");
    this._toolGrid = createPillGrid(
      [{ label: "Brush", value: "add" }, { label: "Erase", value: "erase" }],
      2, (v) => this._setTool(v), { activeValue: "add" },
    );
    secTools.content.appendChild(this._toolGrid.el);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    row.append(
      createButton("Invert", { variant: "standard", iconSrc: UI + "swap.svg", onClick: () => this._invertMask() }),
      createButton("Clear", { variant: "standard", iconSrc: UI + "delete.svg", onClick: () => this._clearMask() }),
    );
    for (const b of row.children) b.style.flex = "1";
    secTools.content.appendChild(row);
    sidebar.appendChild(secTools.el);

    // Brush
    const secBrush = createPanel("Brush");
    this.el.sizeSlider = createSliderRow("Size", 2, 300, this.brushSize, () => {
      this.brushSize = parseInt(this.el.sizeSlider.numInput.value) || this.brushSize;
    });
    this.el.softSlider = createSliderRow("Soft edge", 0, 100, Math.round(this.softness * 100), () => {
      this.softness = (parseInt(this.el.softSlider.numInput.value) || 0) / 100;
    });
    secBrush.content.append(this.el.sizeSlider.el, this.el.softSlider.el);
    sidebar.appendChild(secBrush.el);

    // View
    const secView = createPanel("Mask overlay");
    this._visBtn = createButton("Toggle mask (H)", { variant: "full", iconSrc: UI + "eraser.svg", onClick: () => this._toggleMaskVisible() });
    this.el.opacitySlider = createSliderRow("Opacity", 10, 100, Math.round(this.maskOpacity * 100), () => {
      this.maskOpacity = (parseInt(this.el.opacitySlider.numInput.value) || 50) / 100;
      this._draw();
    });
    secView.content.append(this._visBtn, this.el.opacitySlider.el);
    sidebar.appendChild(secView.el);

    // Context margin (mirrors node context_px, updates the preview live)
    const secCtx = createPanel("Context margin");
    const ctxStart = this.params.context_px != null ? this.params.context_px : 24;
    this.el.ctxSlider = createSliderRow("Pixels", 0, 512, ctxStart, () => {
      this.params.context_px = parseInt(this.el.ctxSlider.numInput.value) || 0;
      this._recomputeRegion();
      this._draw();
    });
    secCtx.content.appendChild(this.el.ctxSlider.el);
    sidebar.appendChild(secCtx.el);

    // Load Image
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.style.display = "none";
    fileInput.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) {
        const reader = new FileReader();
        reader.onload = (ev) => { this._loadImageFromDataURL(ev.target.result); this.onLoadImage?.(); };
        reader.readAsDataURL(f);
      }
      fileInput.value = "";
    });
    const loadBtn = createButton("Load Image", { variant: "full", iconSrc: UI + "image.svg", onClick: () => fileInput.click() });
    loadBtn.style.marginTop = "10px";
    sidebar.append(loadBtn, fileInput);
  }

  _buildRightSidebar(sidebar, footer) {
    const sec = createPanel("Output crop");
    this._infoBlock = createInfo("Paint a mask to begin");
    sidebar.insertBefore(sec.el, footer);
    sec.content.appendChild(this._infoBlock.el);
  }

  _setTool(v) { this.tool = v; }

  _toggleMaskVisible() {
    this.maskVisible = !this.maskVisible;
    this._visBtn.classList.toggle("active", !this.maskVisible);
    this._draw();
  }

  _setStatus(msg) { this.layout?.setStatus(msg); }
}
