import { app } from "../../../scripts/app.js";
import { PaintStudio } from "./pixaroma_paint_core.js";
import { allow_debug, createDummyWidget } from "./pixaroma_shared.js";

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

    // ── Container ──
    let container = document.createElement("div");
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
      "Paint",
      "Pixaroma",
      `Click 'Open Paint' to start`,
    );
    container.appendChild(dummy_widget);

    // ── Info label ──
    const infoLabel = document.createElement("div");
    infoLabel.style.cssText = "color:#888;font-size:10px;text-align:center;";
    infoLabel.textContent = "";
    container.appendChild(infoLabel);

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

      studio.onClose = () => {
        node.setDirtyCanvas(true, true);
      };

      studio.open(paintJson);
    });

    // ── DOM widget ──
    let widget = node.addDOMWidget("PaintWidget", "custom", container, {
      getValue: () => ({ paint_json: paintJson }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          paintJson = v.paint_json || "{}";
        }
      },
      getMinHeight: () => 210,
      margin: 5,
    });

    node.onResize = () => {};

    // cleanup when node is removed
    node.onRemoved = () => {
      widget = null;
      container = null;
    };

    setTimeout(() => {
      container.style.display = "flex";
      node.setDirtyCanvas(true, true);
    }, 100);
  },
});
