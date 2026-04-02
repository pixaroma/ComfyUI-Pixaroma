import { app } from "../../../scripts/app.js";
import { CropEditor } from "./pixaroma_crop_core.js";
import { allow_debug, createDummyWidget } from "./pixaroma_shared.js";

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

    // ── Container ──
    const container = document.createElement("div");
    container.style.cssText = `
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0px;
      padding: 5px;
      background-color: #2a2a2a;
      border-radius: 4px;
      width: 100%;
      overflow: hidden;
    `;

    // ── Preview image ──
    const preview = document.createElement("img");
    preview.style.cssText = `
      display: none;
      width: 100%;
      border-radius: 4px;
      object-fit: contain;
    `;
    container.appendChild(preview);

    const dummy_widget = createDummyWidget(
      "Image Crop",
      "Pixaroma",
      `Click 'Open Crop' to start`,
    );
    container.appendChild(dummy_widget);

    // ── Info label ──
    const infoLabel = document.createElement("div");
    infoLabel.style.cssText = "color:#888;font-size:10px;text-align:center;";
    infoLabel.textContent = "";
    container.appendChild(infoLabel);

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
          const img = new Image();
          img.onload = () => {
            dummy_widget.style.display = "none";
            preview.src = dataURL;
            preview.style.display = "block";
            infoLabel.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
            node.setDirtyCanvas(true, true);
          };
          img.src = dataURL;
        }
      };

      editor.onClose = () => {
        node.setDirtyCanvas(true, true);
      };

      editor.open(cropJson);
    });

    // ── DOM widget ──
    const widget = node.addDOMWidget("CropWidget", "custom", container, {
      getValue: () => ({ crop_json: cropJson }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          cropJson = v.crop_json || "{}";
        }
      },
      getMinHeight: () => 210,
      margin: 5,
    });

    node.onResize = () => {};

    setTimeout(() => {
      container.style.display = "flex";
      node.setDirtyCanvas(true, true);
    }, 100);
  },
});
