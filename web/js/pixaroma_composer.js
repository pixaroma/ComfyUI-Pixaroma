import { app } from "../../../scripts/app.js";
import { PixaromaEditor } from "./pixaroma_composer_core.js";
import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "./pixaroma_shared.js";

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

      editor.onSaveToDisk = (dataURL) => downloadDataURL(dataURL, "pixaroma_composer");

      editor.onClose = () => {
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

    activateNodePreview(parts, node);
  },
});
