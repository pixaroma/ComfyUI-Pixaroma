import { app } from "/scripts/app.js";
import { CropEditor } from "./pixaroma_crop_core.js";
import { createPlaceholder, resizeNode, hideJsonWidget, restorePreview } from "./pixaroma_node_utils.js";

app.registerExtension({
    name: "Pixaroma.Crop",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PixaromaCrop") return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            hideJsonWidget(this.widgets, "crop_json");
            this.addWidget("button", "Open Crop", null, () => {
                const jw = this.widgets?.find(w => w.name === "crop_json");
                const node = this;
                const editor = new CropEditor();
                let savedImg = null;
                editor.onClose = () => {
                    // Re-apply preview and trigger canvas redraw AFTER overlay is removed
                    if (savedImg) { node.imgs = [savedImg]; }
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                };
                editor.onSave = (jsonStr, dataURL) => {
                    if (jw) {
                        jw.value = jsonStr;
                        if (node.widgets_values) {
                            const i = node.widgets.findIndex(w => w.name === "crop_json");
                            if (i > -1) node.widgets_values[i] = jsonStr;
                        }
                        if (jw.callback) jw.callback(jw.value);
                    }
                    if (app.graph) {
                        app.graph.setDirtyCanvas(true, true);
                        if (typeof app.graph.change === "function") app.graph.change();
                    }
                    // Use dataURL for immediate preview (no server round-trip race condition)
                    const img = new Image();
                    img.onload = () => { savedImg = img; node.imgs = [img]; resizeNode(node, img, app); };
                    img.src = dataURL;
                };
                editor.open(jw?.value || "{}");
            });
            createPlaceholder("Image Crop", "Open Crop", this, app);
        };

        const origCfg = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (data) {
            origCfg?.apply(this, arguments);
            hideJsonWidget(this.widgets, "crop_json");
            restorePreview(this, "crop_json", app);
        };
    },
});
