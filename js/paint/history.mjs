// ============================================================
// Pixaroma Paint Studio — Undo/redo snapshot system
// ============================================================
import { PaintStudio } from "./core.mjs";

const proto = PaintStudio.prototype;

proto._pushHistory = function () {
  const ly = this.layers[this.activeIdx];
  if (!ly) return;
  const id = ly.ctx.getImageData(0, 0, this.docW, this.docH);
  if (this.historyIndex < this.history.length - 1)
    this.history = this.history.slice(0, this.historyIndex + 1);
  this.history.push({
    layerIdx: this.activeIdx,
    data: id,
    transform: { ...ly.transform },
  });
  if (this.history.length > this.MAX_HISTORY) this.history.shift();
  this.historyIndex = this.history.length - 1;
};

// Full snapshot for destructive ops (flatten, merge, delete layer)
// Saves ALL layers' pixel data so the entire state can be restored.
// Capped at MAX_FULL_SNAPSHOTS to limit memory (each stores all layers' ImageData).
proto._pushFullSnapshot = function () {
  const snapshot = this.layers.map((ly) => ({
    name: ly.name,
    id: ly.id,
    visible: ly.visible,
    locked: ly.locked,
    opacity: ly.opacity,
    blendMode: ly.blendMode,
    sourceKind: ly.sourceKind,
    transform: { ...ly.transform },
    imageData: ly.ctx.getImageData(0, 0, this.docW, this.docH),
  }));
  if (this.historyIndex < this.history.length - 1)
    this.history = this.history.slice(0, this.historyIndex + 1);
  this.history.push({ type: "full", activeIdx: this.activeIdx, snapshot });
  if (this.history.length > this.MAX_HISTORY) this.history.shift();
  this.historyIndex = this.history.length - 1;
  // Evict oldest full snapshots when there are too many (memory-heavy)
  const MAX_FULL = 10;
  let fullCount = 0;
  for (let i = this.history.length - 1; i >= 0; i--) {
    if (this.history[i].type === "full") fullCount++;
    if (fullCount > MAX_FULL) {
      this.history.splice(i, 1);
      this.historyIndex = Math.min(this.historyIndex, this.history.length - 1);
      break;
    }
  }
};

proto.undo = function () {
  if (this.historyIndex < 0) {
    this._setStatus("Nothing to undo");
    return;
  }
  const entry = this.history[this.historyIndex];

  if (entry.type === "full") {
    // Full snapshot: save current state for redo, then restore all layers
    entry._afterSnapshot = this.layers.map((ly) => ({
      name: ly.name,
      id: ly.id,
      visible: ly.visible,
      locked: ly.locked,
      opacity: ly.opacity,
      blendMode: ly.blendMode,
      transform: { ...ly.transform },
      imageData: ly.ctx.getImageData(0, 0, this.docW, this.docH),
    }));
    entry._afterActiveIdx = this.activeIdx;
    // Restore layers from snapshot
    this.layers = entry.snapshot.map((s) => {
      const ly = this._makeLayer(s.name);
      ly.id = s.id;
      ly.visible = s.visible;
      ly.locked = s.locked;
      ly.opacity = s.opacity;
      ly.blendMode = s.blendMode;
      ly.transform = { ...s.transform };
      ly.ctx.putImageData(s.imageData, 0, 0);
      return ly;
    });
    this.activeIdx = entry.activeIdx;
  } else {
    const ly = this.layers[entry.layerIdx];
    if (ly) {
      entry._afterData = ly.ctx.getImageData(0, 0, this.docW, this.docH);
      entry._afterTransform = { ...ly.transform };
      ly.ctx.putImageData(entry.data, 0, 0);
      if (entry.transform) ly.transform = { ...entry.transform };
    }
  }
  this.historyIndex--;
  this._contentBoundsCache.clear();
  this._updateLayersPanel();
  this._syncTransformPanel();
  this._renderDisplay();
  this._setStatus("Undo");
};

proto.redo = function () {
  if (this.historyIndex >= this.history.length - 1) {
    this._setStatus("Nothing to redo");
    return;
  }
  this.historyIndex++;
  const entry = this.history[this.historyIndex];

  if (entry.type === "full") {
    // Restore the state after the destructive operation
    if (entry._afterSnapshot) {
      this.layers = entry._afterSnapshot.map((s) => {
        const ly = this._makeLayer(s.name);
        ly.id = s.id;
        ly.visible = s.visible;
        ly.locked = s.locked;
        ly.opacity = s.opacity;
        ly.blendMode = s.blendMode;
        if (s.sourceKind) ly.sourceKind = s.sourceKind;
        ly.transform = { ...s.transform };
        ly.ctx.putImageData(s.imageData, 0, 0);
        return ly;
      });
      this.activeIdx = entry._afterActiveIdx;
    }
  } else {
    const ly = this.layers[entry.layerIdx];
    if (ly) {
      if (entry._afterData) {
        ly.ctx.putImageData(entry._afterData, 0, 0);
        if (entry._afterTransform) ly.transform = { ...entry._afterTransform };
      } else {
        ly.ctx.putImageData(entry.data, 0, 0);
        if (entry.transform) ly.transform = { ...entry.transform };
      }
    }
  }
  this._contentBoundsCache.clear();
  this._updateLayersPanel();
  this._syncTransformPanel();
  this._renderDisplay();
  this._setStatus("Redo");
};
