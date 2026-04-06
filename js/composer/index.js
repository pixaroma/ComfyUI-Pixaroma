import { app } from "../../../../scripts/app.js";
import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "../shared/index.mjs";

// Import core class first, then mixins as side-effects
import { PixaromaEditor } from "./core.mjs";
import "./eraser.mjs";
import "./render.mjs";
import "./interaction.mjs";
import "./placeholder.mjs";
import { getUpstreamImageUrlForNode } from "./placeholder.mjs";

// Re-export so other modules can import from index
export { PixaromaEditor };

app.registerExtension({
  name: "Pixaroma.ImageComposer",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "PixaromaImageComposition") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      if (allow_debug) console.log("PixaromaImageComposer executed");
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaImageComposition") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── Shared preview system ──
    const parts = createNodePreview(
      "Image Composer",
      "Pixaroma",
      "Click 'Open Image Composer' to start",
    );

    // ── State — mirrors the hidden project_json widget ──
    let projectJson = "{}";

    // ── Open button ──
    node.addWidget("button", "Open Image Composer", null, () => {
      const editor = new PixaromaEditor(node);
      node._pixaromaEditor = editor;

      editor.onSave = (jsonStr, dataURL) => {
        projectJson = jsonStr;
        widget.value = { project_json: jsonStr };

        if (dataURL) {
          let dimText = null;
          try {
            const meta = JSON.parse(jsonStr);
            dimText = `${meta.doc_w || "?"}\u00d7${meta.doc_h || "?"}`;
          } catch {}
          showNodePreview(parts, dataURL, dimText, node);
        }

        node.setDirtyCanvas(true, true);
      };

      editor.onSaveToDisk = (dataURL) =>
        downloadDataURL(dataURL, "pixaroma_composer");

      editor.onClose = () => {
        editor.syncNodeInputs();
        node._pixaromaEditor = null;
        node.setDirtyCanvas(true, true);
      };
    });

    // ── DOM widget ──
    let widget = node.addDOMWidget(
      "ComposerWidget",
      "custom",
      parts.container,
      {
        getValue: () => ({ project_json: projectJson }),
        setValue: (v) => {
          if (v && typeof v === "object") {
            projectJson = v.project_json || "{}";
            restoreNodePreview(parts, projectJson, node);
          }
        },
        getMinHeight: () => 210,
        margin: 5,
      },
    );

    // cleanup when node is removed
    node.onRemoved = () => {
      widget = null;
    };

    // Default auto-preview (Bugged on some cases like erase mask)
    node._pixaromaAutoPreview = false;

    // Full re-composite: render all layers in z-order, replacing connected
    // placeholders with their upstream image (respecting fill mode).
    const rebuildPreview = () => {
      let meta;
      try { meta = JSON.parse(projectJson); } catch { return; }
      if (!meta) return;

      const docW = meta.doc_w || 1024;
      const docH = meta.doc_h || 1024;
      const layers = meta.layers || [];
      if (layers.length === 0) return;

      // Check if any placeholder is connected
      const hasConnected = layers.some((l) => {
        if (!l.isPlaceholder) return false;
        return !!getUpstreamImageUrlForNode(node, `image_${l.inputIndex}`);
      });
      if (!hasConnected) {
        restoreNodePreview(parts, projectJson, node);
        return;
      }

      // Build load list for every visible layer
      const loadList = [];
      for (const layer of layers) {
        if (layer.visible === false) { loadList.push({ layer, url: null }); continue; }
        if (layer.isPlaceholder) {
          const url = getUpstreamImageUrlForNode(node, `image_${layer.inputIndex}`);
          loadList.push({ layer, url, isPlaceholder: true });
        } else {
          const src = layer.src;
          if (!src || src === "__placeholder__") { loadList.push({ layer, url: null }); continue; }
          const fn = src.split(/[\\/]/).pop();
          loadList.push({ layer, url: `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}` });
        }
      }

      // Load all images
      let loaded = 0;
      const images = new Array(loadList.length);
      const total = loadList.length;

      loadList.forEach((item, i) => {
        if (!item.url) { if (++loaded === total) compositeAll(); return; }
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => { images[i] = img; if (++loaded === total) compositeAll(); };
        img.onerror = () => { if (++loaded === total) compositeAll(); };
        img.src = item.url;
      });

      function applyFillMode(img, phW, phH, mode) {
        const c = document.createElement("canvas");
        c.width = phW; c.height = phH;
        const ctx = c.getContext("2d");
        const sw = img.naturalWidth, sh = img.naturalHeight;
        if (mode === "fill") {
          ctx.drawImage(img, 0, 0, phW, phH);
        } else if (mode === "contain") {
          const s = Math.min(phW / sw, phH / sh);
          const dw = sw * s, dh = sh * s;
          ctx.drawImage(img, (phW - dw) / 2, (phH - dh) / 2, dw, dh);
        } else {
          const s = Math.max(phW / sw, phH / sh);
          const dw = sw * s, dh = sh * s;
          ctx.drawImage(img, (phW - dw) / 2, (phH - dh) / 2, dw, dh);
        }
        return c;
      }

      function drawLayer(ctx, layer, img) {
        const natW = img.naturalWidth || img.width;
        const natH = img.naturalHeight || img.height;
        const sx = Math.abs(layer.scaleX || 1), sy = Math.abs(layer.scaleY || 1);
        const w = natW * sx, h = natH * sy;
        const cx = layer.cx ?? docW / 2, cy = layer.cy ?? docH / 2;
        const rot = (layer.rotation || 0) * Math.PI / 180;
        ctx.save();
        ctx.globalAlpha = layer.opacity ?? 1;
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }

      function compositeAll() {
        const cvs = document.createElement("canvas");
        cvs.width = docW; cvs.height = docH;
        const ctx = cvs.getContext("2d");

        loadList.forEach((item, i) => {
          if (item.layer.visible === false) return;
          const img = images[i];

          if (item.isPlaceholder) {
            if (img) {
              const phW = item.layer.naturalWidth || 512;
              const phH = item.layer.naturalHeight || 512;
              const fitted = applyFillMode(img, phW, phH, item.layer.fillMode || "cover");
              drawLayer(ctx, item.layer, fitted);
            } else {
              // No connection — draw solid color placeholder with label
              const phW = item.layer.naturalWidth || 512;
              const phH = item.layer.naturalHeight || 512;
              const color = item.layer.placeholderColor || "#808080";
              const pc = document.createElement("canvas");
              pc.width = phW; pc.height = phH;
              const pCtx = pc.getContext("2d");
              pCtx.fillStyle = color;
              pCtx.fillRect(0, 0, phW, phH);
              const fontSize = Math.max(14, Math.min(phW, phH) / 6);
              pCtx.font = `bold ${fontSize}px Arial, sans-serif`;
              pCtx.textAlign = "center";
              pCtx.textBaseline = "middle";
              pCtx.fillStyle = "rgba(255,255,255,0.85)";
              pCtx.fillText(item.layer.name || `image_${item.layer.inputIndex}`, phW / 2, phH / 2);
              drawLayer(ctx, item.layer, pc);
            }
          } else if (img) {
            drawLayer(ctx, item.layer, img);
          }
        });

        const dataURL = cvs.toDataURL("image/png");
        const dimText = `${docW}\u00d7${docH}`;
        showNodePreview(parts, dataURL, dimText, node);
      }
    };

    node.onConnectionsChange = (type, slotIndex, connected) => {
      if (type !== LiteGraph.INPUT) return;
      const inputName = node.inputs?.[slotIndex]?.name;
      if (!inputName || !inputName.startsWith("image_")) return;

      if (node._pixaromaEditor) {
        // Editor is open — just refresh UI, skip heavy preview rebuild
        node._pixaromaEditor.ui.updateActiveLayerUI();
      } else if (node._pixaromaAutoPreview) {
        // Editor is closed — rebuild node preview composite
        rebuildPreview();
      }
    };

    activateNodePreview(parts, node);
  },
});
