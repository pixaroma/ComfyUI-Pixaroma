import { app } from "../../../scripts/app.js";
import { PixaromaEditor } from "./pixaroma_composer_core.js";
import { allow_debug, createDummyWidget } from "./pixaroma_shared.js";

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
      "Image Composer",
      "Pixaroma",
      `Click 'Open Image Composer' to start`,
    );
    container.appendChild(dummy_widget);

    // ── Info label ──
    const infoLabel = document.createElement("div");
    infoLabel.style.cssText = "color:#888;font-size:10px;text-align:center;";
    infoLabel.textContent = "";
    container.appendChild(infoLabel);

    // ── State — mirrors the hidden project_json widget ──
    let projectJson = "{}";

    // Attempt to restore preview from a saved composite_path in JSON
    const tryRestorePreview = (json) => {
      try {
        const meta = JSON.parse(json);
        if (meta.composite_path) {
          const fn = meta.composite_path.split(/[\/\\]/).pop();
          const img = new Image();
          img.onload = () => {
            dummy_widget.style.display = "none";
            preview.src = img.src;
            preview.style.display = "block";
            infoLabel.textContent = `${meta.doc_w || "?"}×${meta.doc_h || "?"}`;
            node.setDirtyCanvas(true, true);
          };
          img.src = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
        }
      } catch {}
    };

    // ── Open button ──
    node.addWidget("button", "Open Image Composer", null, () => {
      const editor = new PixaromaEditor(node);

      editor.onSave = (jsonStr, dataURL) => {
        projectJson = jsonStr;
        widget.value = { project_json: jsonStr };

        if (dataURL) {
          const img = new Image();
          img.onload = () => {
            dummy_widget.style.display = "none";
            preview.src = dataURL;
            preview.style.display = "block";
            try {
              const meta = JSON.parse(jsonStr);
              infoLabel.textContent = `${meta.doc_w || "?"}×${meta.doc_h || "?"}`;
            } catch {
              infoLabel.textContent = "Scene saved";
            }
            node.setDirtyCanvas(true, true);
          };
          img.src = dataURL;
        }

        node.setDirtyCanvas(true, true);
      };

      editor.onClose = () => {
        node.setDirtyCanvas(true, true);
      };
    });

    // ── DOM widget ──
    let widget = node.addDOMWidget("ComposerWidget", "custom", container, {
      getValue: () => ({ project_json: projectJson }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          projectJson = v.project_json || "{}";
          tryRestorePreview(projectJson);
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

    // Show container after short delay to avoid flicker
    setTimeout(() => {
      container.style.display = "flex";
      node.setDirtyCanvas(true, true);
    }, 100);
  },
});
