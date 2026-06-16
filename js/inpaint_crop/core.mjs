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
// Brush default size (used by the "Reset to default" button in the Brush panel).
const DEFAULT_BRUSH_SIZE = 80;   // px diameter

// Mask/seam preview tint options (display only). Orange recolors the crop box.
export const INPAINT_PREVIEW_COLORS = {
  Red: "#f6303a", Green: "#25d366", Blue: "#3a9bff", Yellow: "#ffd21a", Orange: "#ff8c1a",
};

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
    this.onPreviewColor = null;  // host persists the preview tint setting
    this.el = {};
    this.layout = null;
    this.img = null;
    this.imgW = 0;
    this.imgH = 0;
    this.projectId = null;
    this._scale = 1;        // effective source->display px = _baseScale * _zoom
    this._baseScale = 1;    // fit-to-window scale (zoom 1)
    this._zoom = 1;         // 1 = fit; wheel zooms toward the cursor
    this._panX = 0;         // display-px offset of the image origin (0 at fit)
    this._panY = 0;
    this._dispW = 0;   // logical display (viewport) size, set by _fitCanvas before any draw
    this._dispH = 0;
    this._srcPath = "";
    this._maskPath = "";
    this._pendingSrcDataURL = null;

    // brush / mask state
    this.tool = "add";           // "add" | "erase"
    this.brushSize = DEFAULT_BRUSH_SIZE;   // display px (diameter); persists per node across opens
    this.softness = 0;                     // crisp brush; the seam Softness slider owns blending now
    this.maskOpacity = 0.5;
    this.maskVisible = true;
    this.previewColor = "#f6303a";   // mask + seam preview tint (display only)
    this._cropBoxColor = null;       // crop-box stroke override (white when orange tint)
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
  open(jsonStr, upstreamUrl, params, prefs) {
    let data = {};
    try { data = jsonStr && jsonStr !== "{}" ? JSON.parse(jsonStr) : {}; } catch (e) {}

    this.projectId = data.project_id || "inpaint_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    this._srcPath = data.src_path || "";
    this._maskPath = data.mask_path || "";
    this.params = { ...(params || {}) };
    if (this.params.blend == null) this.params.blend = 16;
    this._fromUpstream = !!upstreamUrl;

    // restore brush prefs from a previous open on this node (size / opacity
    // persist across opens; absent -> the constructor defaults above).
    if (prefs && typeof prefs === "object") {
      if (prefs.brushSize != null) this.brushSize = prefs.brushSize;
      if (prefs.maskOpacity != null) this.maskOpacity = prefs.maskOpacity;
    }

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
      this._setStatus("No source loaded. Wire an IMAGE input and run the workflow once, or click Load Image — or just paste / drag an image in here.");
    }
    this._bindKeys();
    this._bindDropPaste();   // paste / drag-drop an image straight into the editor
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
      helpTitle: "Inpaint Crop — Guide",
      helpContent: `
        <b style="color:#f66744;">WHAT THIS DOES</b><br>
        Paint over the part of the image you want the model to redo. The node finds
        the box around your paint, adds a margin, and crops a clean piece to inpaint.
        The orange box is exactly what gets sent to the model.<br><br>

        <b style="color:#f66744;">PAINTING</b><br>
        <b>Brush / Erase:</b> pick a tool or press <kbd>B</kbd> / <kbd>E</kbd> (hold <kbd>X</kbd> to flip briefly)<br>
        <b>Brush size:</b> <kbd>[</kbd> / <kbd>]</kbd> or the Size slider<br>
        <b>Zoom / Pan:</b> scroll wheel zooms toward the cursor; hold <kbd>Space</kbd> and drag (or middle-drag) to pan; scroll out to fit<br>
        <b>Show / hide mask:</b> <kbd>H</kbd><br>
        <b>Invert / Clear:</b> buttons in the sidebar (Invert = swap painted &harr; unpainted)<br>
        <b>Load a different image:</b> the Load Image button, or just <b>paste</b> / <b>drag</b> an image straight in here<br><br>

        <b style="color:#f66744;">CROP SIZE</b> (sidebar + node)<br>
        <b>Keep shape:</b> scales your area so its long side hits Target, no stretching (best quality)<br>
        <b>Force square:</b> always a Target&times;Target square<br>
        <b>Free:</b> natural size, just rounded to the Multiple<br>
        <b>Context margin:</b> how much of the surroundings to include around your paint<br><br>

        <b style="color:#f66744;">SEAM — HOW IT BLENDS BACK</b><br>
        <b>Softness:</b> how far the paste fades into the original at the edge (the live orange tint previews it)<br>
        <b>Mask grow:</b> expands the painted area a little before cropping<br>
        <b>Blend mode — Mask:</b> only the area you painted is replaced, the rest of the crop keeps the original (the normal inpaint)<br>
        <b>Blend mode — Whole crop:</b> the <i>entire</i> box is replaced with the model's version — use when the model also relit / changed the surroundings, or for an img2img pass<br><br>

        <b style="color:#f66744;">KEYS</b><br>
        <b>Undo / Redo:</b> <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd> &middot;
        <b>Save:</b> <kbd>Ctrl+S</kbd> &middot; <b>Close:</b> <kbd>Escape</kbd>`,
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
      [{ label: "Brush (B)", value: "add" }, { label: "Erase (E)", value: "erase" }],
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
    const sizeHint = document.createElement("div");
    sizeHint.innerHTML = "[ smaller  ·  ] bigger<br>scroll = zoom  ·  space-drag = pan";
    sizeHint.style.cssText = "font-size:10px;color:#888;margin-top:5px;line-height:1.5;";
    secBrush.content.append(this.el.sizeSlider.el, sizeHint);
    sidebar.appendChild(secBrush.el);

    // Seam (the stitch blend; live preview on the canvas)
    const secSeam = createPanel("Seam — how it blends");
    this.el.blendSlider = createSliderRow("Softness", 0, 150, this.params.blend ?? 16, () => {
      this.params.blend = parseInt(this.el.blendSlider.numInput.value) || 0;
      // softness grows the crop once it exceeds context_px (Option B), so the crop
      // box + size badge must recompute - not just the seam tint (mirror Mask grow).
      this._recomputeRegion();
      this._draw();
    });
    this.el.growSlider = createSliderRow("Mask grow", 0, 256, this.params.mask_grow ?? 4, () => {
      this.params.mask_grow = parseInt(this.el.growSlider.numInput.value) || 0;
      this._recomputeRegion();
      this._draw();
    });
    const bmLabel = document.createElement("div");
    bmLabel.textContent = "Blend mode";
    bmLabel.style.cssText = "font-size:11px;color:#aaa;margin:10px 0 5px;";
    this._blendModeGrid = createPillGrid(
      [{ label: "Mask", value: "mask" }, { label: "Whole crop", value: "whole_crop" }],
      2, (v) => { this.params.blend_mode = v; this._draw(); },
      { activeValue: this.params.blend_mode || "mask" },
    );
    secSeam.content.append(this.el.blendSlider.el, this.el.growSlider.el,
      bmLabel, this._blendModeGrid.el);
    sidebar.appendChild(secSeam.el);

    // View
    const secView = createPanel("Mask overlay");
    this._visBtn = createButton("Toggle mask (H)", { variant: "full", iconSrc: UI + "eraser.svg", onClick: () => this._toggleMaskVisible() });
    this.el.opacitySlider = createSliderRow("Opacity", 10, 100, Math.round(this.maskOpacity * 100), () => {
      this.maskOpacity = (parseInt(this.el.opacitySlider.numInput.value) || 50) / 100;
      this._draw();
    });
    secView.content.append(this._visBtn, this.el.opacitySlider.el);
    // preview color swatches (display only; Orange recolors the crop box to white)
    const swatchRow = document.createElement("div");
    swatchRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:8px;";
    const swatchLabel = document.createElement("span");
    swatchLabel.textContent = "Color";
    swatchLabel.style.cssText = "font-size:11px;color:#aaa;margin-right:2px;";
    swatchRow.appendChild(swatchLabel);
    this._colorSwatches = [];
    for (const [name, hex] of Object.entries(INPAINT_PREVIEW_COLORS)) {
      const dot = document.createElement("span");
      dot.title = name;
      dot.style.cssText = `width:20px;height:20px;border-radius:50%;background:${hex};cursor:pointer;box-sizing:border-box;border:2px solid ${this.previewColor === hex ? "#fff" : "transparent"};`;
      dot.addEventListener("click", () => this._setPreviewColor(name, hex));
      this._colorSwatches.push({ dot, hex });
      swatchRow.appendChild(dot);
    }
    secView.content.appendChild(swatchRow);
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

    // Crop size (mirrors the node knobs; live preview)
    const secCrop = createPanel("Crop size");
    this._sizeModeGrid = createPillGrid(
      [{ label: "Keep shape", value: "keep" }, { label: "Force square", value: "force" }, { label: "Free", value: "free" }],
      3, (v) => { this.params.size_mode = v; this._recomputeRegion(); this._draw(); },
      { activeValue: this.params.size_mode || "keep" },
    );
    this.el.targetSlider = createSliderRow("Target", 64, 8192, this.params.target ?? 1024, () => {
      const m = this.params.multiple || 8;
      const raw = parseInt(this.el.targetSlider.numInput.value) || 1024;
      const snapped = Math.max(m, Math.round(raw / m) * m);   // land on the multiple
      this.params.target = snapped;
      if (snapped !== raw) this.el.targetSlider.setValue(snapped);
      this._recomputeRegion(); this._draw();
    });
    this._multipleGrid = createPillGrid(
      [{ label: "8", value: 8 }, { label: "16", value: 16 }, { label: "32", value: 32 }, { label: "64", value: 64 }],
      4, (v) => {
        this.params.multiple = v;
        const snapped = Math.max(v, Math.round((this.params.target || 1024) / v) * v);
        this.params.target = snapped;
        this.el.targetSlider?.setValue(snapped);   // re-snap target to the new multiple
        this._recomputeRegion(); this._draw();
      },
      { activeValue: this.params.multiple || 8 },
    );
    secCrop.content.append(this._sizeModeGrid.el, this.el.targetSlider.el, this._multipleGrid.el);
    sidebar.appendChild(secCrop.el);

    // Reset all settings to default
    const resetAll = createButton("Reset all to default", {
      variant: "standard", iconSrc: UI + "reset.svg", onClick: () => this._resetAll(),
    });
    resetAll.style.marginTop = "10px";
    sidebar.appendChild(resetAll);

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

  _resetAll() {
    this._setTool("add");        // back to Brush (was left on Erase after a reset)
    this.brushSize = DEFAULT_BRUSH_SIZE;
    this.maskOpacity = 0.5;
    this.params.blend = 16;
    this.params.mask_grow = 4;
    this.params.mask_blur = 4;
    this.params.blend_mode = "mask";
    this.params.context_px = 24;
    this.params.size_mode = "keep";
    this.params.target = 1024;
    this.params.multiple = 8;
    this.el.sizeSlider?.setValue(this.brushSize);
    this.el.opacitySlider?.setValue(50);
    this.el.blendSlider?.setValue(16);
    this.el.growSlider?.setValue(4);
    this.el.ctxSlider?.setValue(24);
    this.el.targetSlider?.setValue(1024);
    this._toolGrid?.setActive?.("add");
    this._blendModeGrid?.setActive?.("mask");
    this._sizeModeGrid?.setActive?.("keep");
    this._multipleGrid?.setActive?.(8);
    this._recomputeRegion();
    this._draw();
    if (this._lastCursorPos) this._drawCursor(this._lastCursorPos);
  }

  _setPreviewColor(name, hex) {
    this.previewColor = hex;
    this._cropBoxColor = (hex === INPAINT_PREVIEW_COLORS.Orange) ? "#ffffff" : null;
    for (const s of this._colorSwatches || [])
      s.dot.style.borderColor = (s.hex === hex) ? "#fff" : "transparent";
    this.onPreviewColor?.(name);
    this._draw();
  }

  _toggleMaskVisible() {
    this.maskVisible = !this.maskVisible;
    this._visBtn.classList.toggle("active", !this.maskVisible);
    this._draw();
  }

  _setStatus(msg) { this.layout?.setStatus(msg); }
}
