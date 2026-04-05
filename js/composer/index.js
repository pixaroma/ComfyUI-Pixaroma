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

    // Default auto-preview to true
    node._pixaromaAutoPreview = true;

    // Rebuild node preview by compositing saved image + connected placeholders
    const rebuildPreview = () => {
      let meta;
      try { meta = JSON.parse(projectJson); } catch { return; }
      if (!meta || !meta.composite_path) return;

      const docW = meta.doc_w || 1024;
      const docH = meta.doc_h || 1024;
      const layers = meta.layers || [];
      const placeholders = layers.filter((l) => l.isPlaceholder);
      if (placeholders.length === 0) return;

      // Collect URLs for connected placeholders
      const toLoad = [];
      for (const ph of placeholders) {
        const name = `image_${ph.inputIndex}`;
        const url = getUpstreamImageUrlForNode(node, name);
        if (url) toLoad.push({ ph, url });
      }
      if (toLoad.length === 0) return;

      // Load saved composite as base
      const fn = meta.composite_path.split(/[\\/]/).pop();
      const baseUrl = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
      const baseImg = new Image();
      baseImg.crossOrigin = "Anonymous";
      baseImg.onload = () => {
        let loaded = 0;
        const images = new Array(toLoad.length);
        toLoad.forEach((item, i) => {
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.onload = () => {
            images[i] = img;
            if (++loaded === toLoad.length) compositeAll();
          };
          img.onerror = () => { if (++loaded === toLoad.length) compositeAll(); };
          img.src = item.url;
        });

        function compositeAll() {
          const cvs = document.createElement("canvas");
          cvs.width = docW; cvs.height = docH;
          const ctx = cvs.getContext("2d");
          ctx.drawImage(baseImg, 0, 0, docW, docH);

          toLoad.forEach((item, i) => {
            const img = images[i];
            if (!img) return;
            const ph = item.ph;
            const phW = ph.naturalWidth || 512;
            const phH = ph.naturalHeight || 512;
            const mode = ph.fillMode || "cover";

            // Apply fill mode
            const fitted = document.createElement("canvas");
            fitted.width = phW; fitted.height = phH;
            const fCtx = fitted.getContext("2d");
            const sw = img.naturalWidth, sh = img.naturalHeight;
            if (mode === "fill") {
              fCtx.drawImage(img, 0, 0, phW, phH);
            } else if (mode === "contain") {
              const s = Math.min(phW / sw, phH / sh);
              const dw = sw * s, dh = sh * s;
              fCtx.drawImage(img, (phW - dw) / 2, (phH - dh) / 2, dw, dh);
            } else {
              const s = Math.max(phW / sw, phH / sh);
              const dw = sw * s, dh = sh * s;
              fCtx.drawImage(img, (phW - dw) / 2, (phH - dh) / 2, dw, dh);
            }

            // Apply layer transform
            const sx = Math.abs(ph.scaleX || 1), sy = Math.abs(ph.scaleY || 1);
            const w = phW * sx, h = phH * sy;
            const cx = ph.cx ?? docW / 2, cy = ph.cy ?? docH / 2;
            const rot = (ph.rotation || 0) * Math.PI / 180;

            ctx.save();
            ctx.globalAlpha = ph.opacity ?? 1;
            ctx.translate(cx, cy);
            ctx.rotate(rot);
            ctx.scale(ph.flippedX ? -1 : 1, ph.flippedY ? -1 : 1);
            ctx.drawImage(fitted, -w / 2, -h / 2, w, h);
            ctx.restore();
          });

          const dataURL = cvs.toDataURL("image/png");
          const dimText = `${docW}\u00d7${docH}`;
          showNodePreview(parts, dataURL, dimText, node);
        }
      };
      baseImg.src = baseUrl;
    };

    node.onConnectionsChange = (type, slotIndex, connected) => {
      if (type !== LiteGraph.INPUT) return;
      const inputName = node.inputs?.[slotIndex]?.name;
      if (!inputName || !inputName.startsWith("image_")) return;

      // If editor is open, refresh its UI and load into placeholder
      if (node._pixaromaEditor) {
        const editor = node._pixaromaEditor;
        editor.ui.updateActiveLayerUI();
        if (connected && node._pixaromaAutoPreview) {
          const idx = parseInt(inputName.slice(6), 10);
          const layer = editor.layers.find(
            (l) => l.isPlaceholder && l.inputIndex === idx,
          );
          if (layer) editor.previewPlaceholderInput(layer.id);
        }
      }

      // Rebuild node preview composite with connected images
      if (connected && node._pixaromaAutoPreview) {
        rebuildPreview();
      }
    };

    activateNodePreview(parts, node);
  },
});
