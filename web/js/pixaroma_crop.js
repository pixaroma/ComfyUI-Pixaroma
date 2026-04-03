import { app } from "../../../scripts/app.js";
import { CropEditor } from "./pixaroma_crop_core.js";
import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "./pixaroma_shared.js";

app.registerExtension({
  name: "Pixaroma.Crop",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "PixaromaCrop") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      if (allow_debug) console.log("PixaromaCrop executed");
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaCrop") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── Shared preview system ──
    const parts = createNodePreview(
      "Image Crop",
      "Pixaroma",
      "Click 'Open Crop' to start",
    );

    // ── State — mirrors the hidden crop_json widget ──
    let cropJson = "{}";

    // ── Open button ──
    node.addWidget("button", "Open Crop", null, () => {
      const editor = new CropEditor();

      editor.onSave = (jsonStr, dataURL) => {
        cropJson = jsonStr;
        widget.value = { crop_json: jsonStr };

        if (app.graph) {
          app.graph.setDirtyCanvas(true, true);
          if (typeof app.graph.change === "function") app.graph.change();
        }

        if (dataURL) {
          showNodePreview(parts, dataURL, null, node);
        }
      };

      editor.onSaveToDisk = (dataURL) => downloadDataURL(dataURL, "pixaroma_crop");

      editor.onClose = () => {
        node.setDirtyCanvas(true, true);
      };

      editor.open(cropJson);
    });

    // ── DOM widget ──
    const widget = node.addDOMWidget("CropWidget", "custom", parts.container, {
      getValue: () => ({ crop_json: cropJson }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          cropJson = v.crop_json || "{}";
        }
      },
      getMinHeight: () => 210,
      margin: 5,
    });

    activateNodePreview(parts, node);
  },
});
