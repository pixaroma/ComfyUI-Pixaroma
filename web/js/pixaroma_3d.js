import { app } from "../../../scripts/app.js";
import { Pixaroma3DEditor } from "./pixaroma_3d_core.js";
import { allow_debug, createDummyWidget } from "./pixaroma_shared.js";

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

  // DOM widget creation (same pattern as PixaromaTestNode)
  async nodeCreated(node) {
    if (node.comfyClass !== "Pixaroma3D") return;
    // init size
    node.size = [300, 300];

    // Prevent ComfyUI native image preview (we use our own DOM preview)
    node.imgs = null;

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
      "3D Builder",
      "Pixaroma",
      `Click 'Open 3D Builder' to start`,
    );
    container.appendChild(dummy_widget);

    // ── Info label ──
    const infoLabel = document.createElement("div");
    infoLabel.style.cssText = "color:#888;font-size:10px;text-align:center;";
    infoLabel.textContent = "";
    container.appendChild(infoLabel);

    // ── State ──
    let sceneJson = "{}";

    // Restore preview from scene_json composite_path
    const tryRestorePreview = (json) => {
      try {
        const meta = JSON.parse(json);
        if (meta.composite_path) {
          const fn = meta.composite_path.split(/[\\/]/).pop();
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

    // ── Separate button widget ──
    node.addWidget("button", "Open 3D Builder", null, () => {
      const editor = new Pixaroma3DEditor();

      editor.onSave = (jsonStr, dataURL) => {
        sceneJson = jsonStr;
        widget.value = { scene_json: jsonStr };

        if (dataURL) {
          const img = new Image();
          img.onload = () => {
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

      editor.open(sceneJson);
    });

    // ── DOM widget (sent to Python as kwargs["SceneWidget"]) ──
    let widget = node.addDOMWidget("SceneWidget", "custom", container, {
      getValue: () => ({
        scene_json: sceneJson,
      }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          sceneJson = v.scene_json || "{}";
          tryRestorePreview(sceneJson);
        }
      },
      getMinHeight: () => 210,
      margin: 5,
    });

    node.onResize = () => {
      // handle resize
    };

    // cleanup when node is removed
    node.onRemoved = () => {
      widget = null;
      container = null;
    };

    // show widget after 100ms avoid widget flickering
    setTimeout(() => {
      container.style.display = "flex";
      node.setDirtyCanvas(true, true);
    }, 100);
  },
});
