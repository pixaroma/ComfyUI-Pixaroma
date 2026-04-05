// Placeholder layer management — mixed into PixaromaEditor.prototype
import { PixaromaEditor } from "./core.mjs";

const PH_COLORS = ["#4A90D9", "#E07B54", "#7DC97A", "#C06BC9", "#E8C547"];

PixaromaEditor.prototype._nextPlaceholderIndex = function () {
  const used = new Set(
    this.layers.filter((l) => l.isPlaceholder).map((l) => l.inputIndex),
  );
  let i = 1;
  while (used.has(i)) i++;
  return i;
};

PixaromaEditor.prototype._makePlaceholderImage = function (w, h, color, inputName) {
  const c = document.createElement("canvas");
  c.width = Math.max(w, 1);
  c.height = Math.max(h, 1);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  const fontSize = Math.max(14, Math.min(c.width, c.height) / 6);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(inputName, c.width / 2, c.height / 2);
  return c;
};

PixaromaEditor.prototype.addPlaceholderLayer = function () {
  const idx = this._nextPlaceholderIndex();
  const inputName = `image_${idx}`;
  const color = PH_COLORS[(idx - 1) % PH_COLORS.length];
  const w = Math.round(this.docWidth / 2);
  const h = Math.round(this.docHeight / 2);

  const layer = {
    id: Date.now().toString(),
    name: inputName,
    isPlaceholder: true,
    placeholderColor: color,
    inputIndex: idx,
    fillMode: "cover",
    img: this._makePlaceholderImage(w, h, color, inputName),
    cx: this.docWidth / 2,
    cy: this.docHeight / 2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flippedX: false,
    flippedY: false,
    rawB64_internal: null,
    rawServerPath: "__placeholder__",
    savedOnServer: true,
    eraserMaskCanvas_internal: null,
    eraserMaskCtx_internal: null,
    hasMask_internal: false,
    savedMaskPath_internal: null,
  };

  this.layers.push(layer);
  this.selectedLayerIds.clear();
  this.selectedLayerIds.add(layer.id);
  this.syncActiveLayerIndex();
  this.ui.updateActiveLayerUI();
  this.draw();
  this.pushHistory();
  this.syncNodeInputs();
};

PixaromaEditor.prototype.convertLayerToPlaceholder = function (layerId) {
  const layer = this.layers.find((l) => l.id === layerId);
  if (!layer || layer.isPlaceholder) return;

  const idx = this._nextPlaceholderIndex();
  const inputName = `image_${idx}`;
  const color = PH_COLORS[(idx - 1) % PH_COLORS.length];
  const w = layer.img ? layer.img.width : Math.round(this.docWidth / 2);
  const h = layer.img ? layer.img.height : Math.round(this.docHeight / 2);

  layer.isPlaceholder = true;
  layer.placeholderColor = color;
  layer.inputIndex = idx;
  layer.fillMode = "cover";
  layer.name = inputName;
  layer.img = this._makePlaceholderImage(w, h, color, inputName);
  layer.rawB64_internal = null;
  layer.rawServerPath = "__placeholder__";
  layer.savedOnServer = true;
  layer.eraserMaskCanvas_internal = null;
  layer.eraserMaskCtx_internal = null;
  layer.hasMask_internal = false;
  layer.savedMaskPath_internal = null;

  this.ui.updateActiveLayerUI();
  this.draw();
  this.pushHistory();
  this.syncNodeInputs();
};

PixaromaEditor.prototype._getInputSlotIndex = function (inputName) {
  const inputs = this.node?.inputs || [];
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i].name === inputName) return i;
  }
  return -1;
};

PixaromaEditor.prototype.isPlaceholderConnected = function (layer) {
  if (!layer?.isPlaceholder || !this.node) return false;
  const slotIdx = this._getInputSlotIndex(`image_${layer.inputIndex}`);
  if (slotIdx < 0) return false;
  const input = this.node.inputs[slotIdx];
  return !!(input && input.link != null);
};

PixaromaEditor.prototype._getUpstreamImageUrl = function (layer) {
  if (!this.node) return null;
  const slotIdx = this._getInputSlotIndex(`image_${layer.inputIndex}`);
  if (slotIdx < 0) return null;
  const input = this.node.inputs[slotIdx];
  if (!input || input.link == null) return null;

  const graph = this.node.graph;
  if (!graph) return null;
  const link = graph.links[input.link];
  if (!link) return null;
  const srcNode = graph.getNodeById(link.origin_id);
  if (!srcNode) return null;

  // LoadImage node: get filename from its "image" widget
  if (srcNode.comfyClass === "LoadImage" || srcNode.type === "LoadImage") {
    const imgWidget = (srcNode.widgets || []).find((w) => w.name === "image");
    if (imgWidget && imgWidget.value) {
      return `/view?filename=${encodeURIComponent(imgWidget.value)}&type=input&t=${Date.now()}`;
    }
  }

  // Any node with preview images (post-execution)
  if (srcNode.imgs && srcNode.imgs.length > 0) {
    const img = srcNode.imgs[link.origin_slot] || srcNode.imgs[0];
    if (typeof img === "string") return img;
    if (img && img.src) return img.src;
  }

  return null;
};

PixaromaEditor.prototype._applyFillMode = function (srcImg, phW, phH, mode) {
  const c = document.createElement("canvas");
  c.width = phW;
  c.height = phH;
  const ctx = c.getContext("2d");
  const sw = srcImg.naturalWidth || srcImg.width;
  const sh = srcImg.naturalHeight || srcImg.height;

  if (mode === "fill") {
    ctx.drawImage(srcImg, 0, 0, phW, phH);
  } else if (mode === "contain") {
    const scale = Math.min(phW / sw, phH / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(srcImg, (phW - dw) / 2, (phH - dh) / 2, dw, dh);
  } else {
    // cover
    const scale = Math.max(phW / sw, phH / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(srcImg, (phW - dw) / 2, (phH - dh) / 2, dw, dh);
  }
  return c;
};

PixaromaEditor.prototype.previewPlaceholderInput = function (layerId) {
  const layer = this.layers.find((l) => l.id === layerId);
  if (!layer || !layer.isPlaceholder) return;

  const url = this._getUpstreamImageUrl(layer);
  if (!url) return;

  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.onload = () => {
    const phW = layer.img.width;
    const phH = layer.img.height;
    layer._previewImg = img;
    layer.img = this._applyFillMode(img, phW, phH, layer.fillMode || "cover");
    this.ui.updateActiveLayerUI();
    this.draw();
    this.pushHistory();
  };
  img.onerror = () => {
    console.warn("[Pixaroma] Failed to load preview for", layer.name);
  };
  img.src = url;
};

PixaromaEditor.prototype.previewAllConnectedPlaceholders = function () {
  this.layers.forEach((l) => {
    if (l.isPlaceholder && this.isPlaceholderConnected(l)) {
      this.previewPlaceholderInput(l.id);
    }
  });
};

/**
 * Get upstream image URL for a given image_N input on a node (no editor needed).
 * Used by onConnectionsChange when editor is closed.
 */
export function getUpstreamImageUrlForNode(node, inputName) {
  const inputs = node.inputs || [];
  const input = inputs.find((inp) => inp.name === inputName);
  if (!input || input.link == null) return null;
  const graph = node.graph;
  if (!graph) return null;
  const link = graph.links[input.link];
  if (!link) return null;
  const srcNode = graph.getNodeById(link.origin_id);
  if (!srcNode) return null;

  if (srcNode.comfyClass === "LoadImage" || srcNode.type === "LoadImage") {
    const imgWidget = (srcNode.widgets || []).find((w) => w.name === "image");
    if (imgWidget && imgWidget.value) {
      return `/view?filename=${encodeURIComponent(imgWidget.value)}&type=input&t=${Date.now()}`;
    }
  }

  if (srcNode.imgs && srcNode.imgs.length > 0) {
    const img = srcNode.imgs[link.origin_slot] || srcNode.imgs[0];
    if (typeof img === "string") return img;
    if (img && img.src) return img.src;
  }

  return null;
}

PixaromaEditor.prototype.syncNodeInputs = function () {
  const node = this.node;
  if (!node) return;

  const placeholders = this.layers.filter((l) => l.isPlaceholder);
  const placeholderIndices = new Set(placeholders.map((p) => p.inputIndex));

  // Remove stale image_N inputs (iterate backwards to preserve indices)
  const inputs = node.inputs || [];
  for (let i = inputs.length - 1; i >= 0; i--) {
    const inp = inputs[i];
    if (inp.name && inp.name.startsWith("image_")) {
      const n = parseInt(inp.name.slice(6), 10);
      if (!isNaN(n) && !placeholderIndices.has(n)) {
        node.removeInput(i);
      }
    }
  }

  // Add inputs for placeholders that don't have a socket yet
  const existingNames = new Set((node.inputs || []).map((inp) => inp.name));
  placeholders.forEach((p) => {
    const name = `image_${p.inputIndex}`;
    if (!existingNames.has(name)) {
      node.addInput(name, "IMAGE");
    }
  });

  node.setDirtyCanvas(true, true);
};
