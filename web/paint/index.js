// ============================================================
// Pixaroma Paint Studio — Entry point (ComfyUI widget registration)
// ============================================================
import { app } from "../../../../scripts/app.js";

// Import core class first, then all mixin files (side-effect imports that add to prototype)
import { PaintStudio } from "./core.js";
import "./canvas.js";
import "./render.js";
import "./transform.js";
import "./events.js";
import "./tools.js";
import "./history.js";
import "./ui.js";

import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "../shared/index.js";

app.registerExtension({
  name: "Pixaroma.Paint",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "PixaromaPaint") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      if (allow_debug) console.log("PixaromaPaint executed");
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaPaint") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── Shared preview system ──
    const parts = createNodePreview(
      "Paint",
      "Pixaroma",
      "Click 'Open Paint' to start",
    );

    // ── State — mirrors the hidden paint_json widget ──
    let paintJson = "{}";

    // ── Open button ──
    node.addWidget("button", "Open Paint", null, () => {
      const studio = new PaintStudio();

      studio.onSave = (jsonStr, dataURL) => {
        paintJson = jsonStr;
        widget.value = { paint_json: jsonStr };

        if (app.graph) {
          app.graph.setDirtyCanvas(true, true);
          if (typeof app.graph.change === "function") app.graph.change();
        }

        if (dataURL) {
          showNodePreview(parts, dataURL, null, node);
        }
      };

      studio.onSaveToDisk = (dataURL) => downloadDataURL(dataURL, "pixaroma_paint");

      studio.onClose = () => {
        node.setDirtyCanvas(true, true);
      };

      studio.open(paintJson);
    });

    // ── DOM widget ──
    let widget = node.addDOMWidget("PaintWidget", "custom", parts.container, {
      getValue: () => ({ paint_json: paintJson }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          paintJson = v.paint_json || "{}";
        }
      },
      getMinHeight: () => 210,
      margin: 5,
    });

    // cleanup when node is removed
    node.onRemoved = () => {
      widget = null;
    };

    activateNodePreview(parts, node);
  },
});
