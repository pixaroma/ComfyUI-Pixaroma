// ============================================================
// Pixaroma 3D Editor — Entry point (ComfyUI widget registration)
// ============================================================
import { app } from "../../../../scripts/app.js";

// Import core class first, then mixin files (side-effect imports add methods to prototype)
import { Pixaroma3DEditor } from "./core.mjs";
import "./engine.mjs";
import "./objects.mjs";
import "./interaction.mjs";
import "./persistence.mjs";

import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "../shared/index.mjs";

app.registerExtension({
  name: "Pixaroma.3DEditor",

  // Handle execution result (OUTPUT_NODE = True on python side)
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "Pixaroma3D") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      if (allow_debug) console.log("Pixaroma3D executed");
    };
  },

  // DOM widget creation
  async nodeCreated(node) {
    if (node.comfyClass !== "Pixaroma3D") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── Shared preview system ──
    const parts = createNodePreview(
      "3D Builder",
      "Pixaroma",
      "Click 'Open 3D Builder' to start",
    );

    // ── State ──
    let sceneJson = "{}";

    // ── Separate button widget ──
    node.addWidget("button", "Open 3D Builder", null, () => {
      const editor = new Pixaroma3DEditor();

      editor.onSave = (jsonStr, dataURL) => {
        sceneJson = jsonStr;
        widget.value = { scene_json: jsonStr };

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
        downloadDataURL(dataURL, "pixaroma_3d");

      editor.onClose = () => {
        node.setDirtyCanvas(true, true);
      };

      editor.open(sceneJson);
    });

    // ── DOM widget (sent to Python as kwargs["SceneWidget"]) ──
    let widget = node.addDOMWidget("SceneWidget", "custom", parts.container, {
      getValue: () => ({
        scene_json: sceneJson,
      }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          sceneJson = v.scene_json || "{}";
          restoreNodePreview(parts, sceneJson, node);
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

// Re-export for backward compatibility
export { Pixaroma3DEditor } from "./core.mjs";
