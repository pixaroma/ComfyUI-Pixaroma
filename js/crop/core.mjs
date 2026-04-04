// ============================================================
// Pixaroma Image Crop Editor — Core (constructor, open/close, buildUI)
// ============================================================
import {
  BRAND,
  createEditorLayout,
  createPanel,
  createButton,
  createPillGrid,
  createSliderRow,
  createInfo,
  createCanvasSettings,
  createCanvasFrame,
  createCanvasToolbar,
} from "../framework/index.mjs";

export const RATIOS = [
    { label: "Free",  w: 0,  h: 0  },
    { label: "1:1",   w: 1,  h: 1  },
    { label: "4:3",   w: 4,  h: 3  },
    { label: "3:2",   w: 3,  h: 2  },
    { label: "16:9",  w: 16, h: 9  },
    { label: "4:5",   w: 4,  h: 5  },
    { label: "3:4",   w: 3,  h: 4  },
    { label: "2:3",   w: 2,  h: 3  },
    { label: "9:16",  w: 9,  h: 16 },
    { label: "5:4",   w: 5,  h: 4  },
];

export const SNAPS = [
    { label: "None", val: 1  },
    { label: "\u00d78",   val: 8  },
    { label: "\u00d716",  val: 16 },
    { label: "\u00d732",  val: 32 },
    { label: "\u00d764",  val: 64 },
];

export const CropAPI = {
    async saveComposite(projectId, dataURL) {
        const { api } = await import("/scripts/api.js");
        const res = await api.fetchApi("/pixaroma/api/crop/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId, image_merged: dataURL }),
        });
        return await res.json();
    },
};

// Re-export BRAND for use in other mixin files
export { BRAND };

// ═════════════════════════════════════════════════════════════
export class CropEditor {
    constructor() {
        this.onSave = null;
        this.onClose = null;
        this.el = {};
        this.layout = null;
        this.img = null;
        this.imgW = 0;
        this.imgH = 0;
        this.projectId = null;
        this.cropX = 0; this.cropY = 0; this.cropW = 0; this.cropH = 0;
        this.ratioIdx = 0;
        this.snapIdx = 0;
        this._drag = null;
        this._scale = 1;
        this._srcPath = "";
    }

    // --- Open / Close ---
    open(jsonStr) {
        this._buildUI();
        this.layout.mount();

        let data = {};
        try { data = jsonStr && jsonStr !== "{}" ? JSON.parse(jsonStr) : {}; } catch (e) {}

        this.projectId = data.project_id || ("crop_" + Date.now());
        this._srcPath = data.src_path || "";

        if (this._srcPath) {
            const fn = this._srcPath.split(/[\\/]/).pop();
            const url = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
            this._loadImageFromURL(url, () => {
                if (data.crop_x != null) {
                    this.cropX = data.crop_x; this.cropY = data.crop_y;
                    this.cropW = data.crop_w; this.cropH = data.crop_h;
                }
                if (data.ratio_idx != null) { this.ratioIdx = data.ratio_idx; this._canvasSettings.setRatio(data.ratio_idx); }
                if (data.snap_idx != null) { this.snapIdx = data.snap_idx; this._snapGrid.setActive(data.snap_idx); }
                this._draw(); this._updateInfo();
            });
        }
        this._bindKeys();
    }

    _close() {
        this.layout?.unmount();
        this._unbindKeys();
        if (this.onClose) this.onClose();
    }

    // --- Build UI ---
    _buildUI() {
        const layout = createEditorLayout({
            editorName: "Image Crop",
            editorId: "pixaroma-crop-editor",
            showUndoRedo: false,
            showStatusBar: true,
            showZoomBar: false,
            onSave: () => this._save(),
            onClose: () => this._close(),
            helpContent: `
                <b>Load image:</b> Click <kbd>Load Image</kbd> in sidebar<br>
                <b>Drag crop region:</b> Click & drag inside the crop area<br>
                <b>Resize crop:</b> Drag orange corner/edge handles<br>
                <b>Reset crop:</b> Press <kbd>R</kbd> or click Reset<br>
                <b>Swap ratio:</b> Press <kbd>X</kbd> to flip W\u2194H ratio<br>
                <b>Free ratio:</b> Press <kbd>F</kbd><br>
                <b>Save:</b> <kbd>Ctrl+S</kbd><br>
                <b>Close:</b> <kbd>Escape</kbd>
            `,
        });
        this.layout = layout;
        layout.onSaveToDisk = () => { this._diskSavePending = true; this._save(); };
        layout.onCleanup = () => this._unbindKeys();
        this.el.overlay = layout.overlay;
        this.el.workspace = layout.workspace;
        this.el.status = layout.statusText;
        this.el.saveBtn = layout.saveBtn;

        // -- Populate sidebars --
        this._buildLeftSidebar(layout.leftSidebar);
        this._buildRightSidebar(layout.rightSidebar, layout.sidebarFooter);

        // -- Canvas in workspace --
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:relative;display:inline-block;";
        this.el.canvasWrap = wrap;

        const cvs = document.createElement("canvas");
        cvs.width = 100; cvs.height = 100;
        this.el.canvas = cvs; this.el.ctx = cvs.getContext("2d");
        wrap.appendChild(cvs);
        layout.workspace.appendChild(wrap);

        // Canvas frame overlay (orange border + gray masks + dimension label)
        this._canvasFrame = createCanvasFrame(layout.workspace);

        this._bindMouse(cvs);

        // Enable drag & drop on workspace
        if (this._canvasToolbar) this._canvasToolbar.setupDropZone(layout.workspace);
    }

    _buildLeftSidebar(sidebar) {
        // -- Canvas Settings (FIRST panel -- unified ratio/size component) --
        this._canvasSettings = createCanvasSettings({
            width: this.imgW || 1024,
            height: this.imgH || 1024,
            ratioIndex: 0,
            startCollapsed: false,
            onChange: ({ width, height, ratioIndex }) => {
                this.ratioIdx = ratioIndex;
                this.ratioSwapped = false;
                if (!this.img) return;
                // Clamp to image bounds
                const nw = Math.min(width, this.imgW);
                const nh = Math.min(height, this.imgH);
                this._setCropCentered(nw, nh);
                this._applyConstraints();
                this._draw();
                this._updateInfo();
                // Sync back if clamped
                this._canvasSettings.setSize(Math.round(this.cropW), Math.round(this.cropH));
            },
        });
        sidebar.appendChild(this._canvasSettings.el);

        // -- Canvas Toolbar (Load Image) --
        this._canvasToolbar = createCanvasToolbar({
            onAddImage: (file) => {
                const reader = new FileReader();
                reader.onload = (ev) => this._loadImageFromDataURL(ev.target.result, file.name);
                reader.readAsDataURL(file);
            },
            showBgColor: false,
            showClear: false,
            addImageLabel: "Load Image",
            onReset: () => {
                this.img = null; this.imgW = 0; this.imgH = 0;
                this.cropX = 0; this.cropY = 0; this.cropW = 0; this.cropH = 0;
                this.ratioIdx = 0; this.snapIdx = 0;
                this._canvasSettings.setRatio(0);
                this._canvasSettings.setSize(1024, 1024);
                this._snapGrid.setActive(0);
                if (this.el.canvas) { this.el.ctx.clearRect(0, 0, this.el.canvas.width, this.el.canvas.height); }
                this._updateInfo();
                this._setStatus("Reset to default");
            },
        });
        sidebar.appendChild(this._canvasToolbar.el);
    }

    _buildRightSidebar(sidebar, footer) {
        // -- Pixel Snap --
        const secSnap = createPanel("Pixel Snap");
        this._snapGrid = createPillGrid(
            SNAPS.map((s, i) => ({ label: s.label, value: i })),
            5,
            (idx) => { this.snapIdx = idx; this._applySnap(); },
            { activeValue: 0 },
        );
        secSnap.content.appendChild(this._snapGrid.el);
        sidebar.insertBefore(secSnap.el, footer);

        // -- Crop Size sliders --
        const secSize = createPanel("Crop Size");
        this.el.sliderW = createSliderRow("W", 1, 4096, 1024, () => this._onSliderChange("w"));
        this.el.sliderH = createSliderRow("H", 1, 4096, 1024, () => this._onSliderChange("h"));
        this.el.sliderX = createSliderRow("X", 0, 4096, 0, () => this._onSliderChange("x"));
        this.el.sliderY = createSliderRow("Y", 0, 4096, 0, () => this._onSliderChange("y"));
        secSize.content.append(this.el.sliderW.el, this.el.sliderH.el, this.el.sliderX.el, this.el.sliderY.el);
        sidebar.insertBefore(secSize.el, footer);

        // -- Info --
        const secInfo = createPanel("Info");
        this._infoBlock = createInfo("No image loaded");
        this.el.info = this._infoBlock.el;
        secInfo.content.appendChild(this._infoBlock.el);
        sidebar.insertBefore(secInfo.el, footer);

        // -- Actions --
        const secAct = createPanel("Actions");
        secAct.content.appendChild(createButton("\u21ba Reset Crop", { variant: "full", onClick: () => this._resetCrop() }));
        sidebar.insertBefore(secAct.el, footer);
    }
}
