import { app } from "/scripts/app.js";
import { PaintStudio } from "./pixaroma_paint_core.js";
import { createPlaceholder, resizeNode, hideJsonWidget, restorePreview } from "./pixaroma_shared.js";

app.registerExtension({
    name: "Pixaroma.Paint",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PixaromaPaint") return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            hideJsonWidget(this.widgets, "paint_json");
            this.addWidget("button", "Open Paint", null, () => {
                const jw = this.widgets?.find(w => w.name === "paint_json");
                const studio = new PaintStudio();
                let savedImg = null;
                studio.onSave = (jsonStr, dataURL) => {
                    if (jw) { jw.value = jsonStr; if (this.widgets_values) { const i = this.widgets.findIndex(w => w.name === "paint_json"); if (i > -1) this.widgets_values[i] = jsonStr; } if (jw.callback) jw.callback(jw.value); }
                    if (app.graph) { app.graph.setDirtyCanvas(true, true); if (typeof app.graph.change === "function") app.graph.change(); }
                    const img = new Image(); img.onload = () => { savedImg = img; this.imgs = [img]; resizeNode(this, img, app); }; img.src = dataURL;
                };
                studio.onClose = () => {
                    // Re-apply preview and trigger canvas redraw AFTER overlay is removed
                    if (savedImg) { this.imgs = [savedImg]; }
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                };
                studio.open(jw?.value || "{}");
            });
            createPlaceholder("Paint", "Open Paint", this, app);
        };

        const origCfg = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (data) {
            origCfg?.apply(this, arguments);
            hideJsonWidget(this.widgets, "paint_json");
            restorePreview(this, "paint_json", app);
        };
    },
});
