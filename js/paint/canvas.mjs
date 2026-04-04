// ============================================================
// Pixaroma Paint Studio — Canvas init, layer CRUD
// ============================================================
import { PaintStudio } from "./core.mjs";

const proto = PaintStudio.prototype;

// ─── Canvas init ──────────────────────────────────────────

proto._initCanvases = function() {
    this.el.displayCanvas.width = this.docW; this.el.displayCanvas.height = this.docH;
    this.strokeCanvas = document.createElement("canvas");
    this.strokeCanvas.width = this.docW; this.strokeCanvas.height = this.docH;
    this.strokeCtx = this.strokeCanvas.getContext("2d");
};

proto._applyDocSize = function() {
    this.el.displayCanvas.width = this.docW; this.el.displayCanvas.height = this.docH;
    if (this.el.cursorCvs) { this.el.cursorCvs.width = this.docW; this.el.cursorCvs.height = this.docH; }
    if (this.strokeCanvas) { this.strokeCanvas.width = this.docW; this.strokeCanvas.height = this.docH; }
};

// ─── Layer management ─────────────────────────────────────

proto._makeLayer = function(name) {
    const cvs = document.createElement("canvas");
    cvs.width = this.docW; cvs.height = this.docH;
    const id = "pylyr_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    return {
        id, name: name || "Layer " + (this.layers.length + 1),
        canvas: cvs, ctx: cvs.getContext("2d"),
        visible: true, locked: false, opacity: 100, blendMode: "source-over",
        transform: { x:0, y:0, scaleX:1, scaleY:1, rotation:0, flipX:false, flipY:false, pivotOffX:0, pivotOffY:0 },
    };
};

proto._addLayer = function(name) {
    const ly = this._makeLayer(name);
    this.layers.unshift(ly); this.activeIdx = 0;
    this.selectedIndices.clear(); this.selectedIndices.add(0);
    this._pushHistory();
    this._updateLayersPanel(); this._renderDisplay();
    this._setStatus(`Layer "${ly.name}" added`);
};

proto._deleteLayer = function() {
    if (this.layers.length <= 1) { this._setStatus("Cannot delete last layer"); return; }
    this._pushFullSnapshot();
    // Delete all selected layers (or just active if no multi-select)
    const toDelete = this.selectedIndices.size > 0 ? [...this.selectedIndices].sort((a,b) => b-a) : [this.activeIdx];
    if (toDelete.length >= this.layers.length) {
        // Delete all but create a fresh empty layer
        this.layers = [];
        const bg = this._makeLayer("Background");
        this.layers.push(bg);
        this.activeIdx = 0;
        this.selectedIndices = new Set([0]);
        this._updateLayersPanel(); this._renderDisplay();
        this._setStatus("All layers deleted \u2014 fresh background created");
        return;
    }
    toDelete.forEach(idx => this.layers.splice(idx, 1));
    this.selectedIndices.clear();
    this.activeIdx = Math.max(0, Math.min(this.activeIdx, this.layers.length - 1));
    this.selectedIndices.add(this.activeIdx);
    this._updateLayersPanel(); this._renderDisplay();
};

proto._duplicateLayer = function() {
    const src = this.layers[this.activeIdx]; if (!src) return;
    const ly = this._makeLayer(src.name + " copy");
    ly.blendMode = src.blendMode; ly.opacity = src.opacity;
    ly.transform = { ...src.transform };
    ly.ctx.drawImage(src.canvas, 0, 0);
    this._pushFullSnapshot();
    this.layers.splice(this.activeIdx, 0, ly);
    this.selectedIndices.clear(); this.selectedIndices.add(this.activeIdx);
    this._updateLayersPanel(); this._renderDisplay();
};

proto._moveLayer = function(dir) {
    const i = this.activeIdx, j = i + dir;
    if (j < 0 || j >= this.layers.length) return;
    [this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]];
    this.activeIdx = j;
    this.selectedIndices.clear(); this.selectedIndices.add(j);
    this._updateLayersPanel(); this._renderDisplay();
};

proto._clearLayer = function() {
    const ly = this.layers[this.activeIdx]; if (!ly || ly.locked) return;
    this._pushHistory();
    ly.ctx.clearRect(0, 0, this.docW, this.docH);
    this._contentBoundsCache.delete(ly.id);
    this._updateLayerThumb(this.activeIdx); this._renderDisplay();
    this._setStatus("Layer cleared");
};

proto._mergeDown = function() {
    const i = this.activeIdx;
    if (i >= this.layers.length - 1) { this._setStatus("No layer below"); return; }
    this._pushFullSnapshot();
    const top = this.layers[i], bot = this.layers[i + 1];
    bot.ctx.save();
    bot.ctx.globalAlpha = top.opacity / 100;
    bot.ctx.globalCompositeOperation = top.blendMode;
    this._drawLayerWithTransform(bot.ctx, top);
    bot.ctx.restore();
    this.layers.splice(i, 1);
    this.activeIdx = Math.min(i, this.layers.length - 1);
    this.selectedIndices.clear(); this.selectedIndices.add(this.activeIdx);
    this._contentBoundsCache.delete(bot.id);
    this._updateLayersPanel(); this._renderDisplay();
};

proto._flattenAll = function() {
    if (this.layers.length <= 1) return;
    // Save full layer stack for undo (destructive operation)
    this._pushFullSnapshot();
    const merged = this._makeLayer("Merged");
    merged.ctx.fillStyle = this.bgColor; merged.ctx.fillRect(0, 0, this.docW, this.docH);
    for (let i = this.layers.length - 1; i >= 0; i--) {
        const ly = this.layers[i]; if (!ly.visible) continue;
        merged.ctx.save();
        merged.ctx.globalAlpha = ly.opacity / 100;
        merged.ctx.globalCompositeOperation = ly.blendMode;
        this._drawLayerWithTransform(merged.ctx, ly);
        merged.ctx.restore();
    }
    this.layers = [merged]; this.activeIdx = 0;
    this._contentBoundsCache.clear();
    this._updateLayersPanel(); this._renderDisplay();
};

proto._loadLayers = async function(layersData) {
    this.layers = [];
    for (const ld of layersData) {
        const ly = this._makeLayer(ld.name || "Layer");
        ly.id = ld.id || ly.id;
        ly.visible  = ld.visible !== false;
        ly.locked   = ld.locked  === true;
        ly.opacity  = ld.opacity  ?? 100;
        ly.blendMode = ld.blend_mode || "source-over";
        ly.transform = ld.transform ? { pivotOffX:0, pivotOffY:0, ...ld.transform } : {x:0,y:0,scaleX:1,scaleY:1,rotation:0,flipX:false,flipY:false,pivotOffX:0,pivotOffY:0};
        if (ld.src) {
            await new Promise(res => {
                const img = new Image(); img.crossOrigin = "anonymous";
                img.onload  = () => { ly.ctx.drawImage(img, 0, 0); res(); };
                img.onerror = () => { console.warn("[Paint] Failed to load layer:", ld.src); res(); };
                const fileNameOnly = ld.src.split(/[\\/]/).pop();
                img.src = `/view?filename=${encodeURIComponent(fileNameOnly)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
            });
        }
        this.layers.push(ly);
    }
    if (this.layers.length === 0) this._addLayer("Layer 1");
    this.activeIdx = 0;
};
