import { app } from "/scripts/app.js";
import { Pixaroma3DEditor } from "./pixaroma_3d_core.js";
import { createPlaceholder, resizeNode, hideJsonWidget, restorePreview } from "./pixaroma_node_utils.js";

app.registerExtension({
    name: "Pixaroma.3DEditor",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Pixaroma3D") return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            hideJsonWidget(this.widgets, "scene_json");
            this.addWidget("button", "Open 3D Builder", null, () => {
                const jw = this.widgets?.find(w => w.name === "scene_json");
                const editor = new Pixaroma3DEditor();
                let savedImg = null;
                editor.onSave = (jsonStr, dataURL) => {
                    if (jw) { jw.value = jsonStr; if (this.widgets_values) { const i = this.widgets.findIndex(w => w.name === "scene_json"); if (i > -1) this.widgets_values[i] = jsonStr; } if (jw.callback) jw.callback(jw.value); }
                    if (app.graph) { app.graph.setDirtyCanvas(true, true); if (typeof app.graph.change === "function") app.graph.change(); }
                    const img = new Image(); img.onload = () => { savedImg = img; this.imgs = [img]; resizeNode(this, img, app); }; img.src = dataURL;
                };
                editor.onClose = () => {
                    if (savedImg) this.imgs = [savedImg];
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                };
                editor.open(jw?.value || "{}");
            });
            createPlaceholder("3D Builder", "Open 3D Builder", this, app);
        };

        const origCfg = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (data) {
            origCfg?.apply(this, arguments);
            hideJsonWidget(this.widgets, "scene_json");
            restorePreview(this, "scene_json", app);
        };
    },
});
