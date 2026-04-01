import { app } from "/scripts/app.js";
import { PixaromaEditor } from "./pixaroma_composer_core.js";
import { createPlaceholder, restorePreview } from "./pixaroma_node_utils.js";

const BASE_WIDTH = 380;

app.registerExtension({
    name: "Pixaroma.ImageComposer",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "PixaromaImageComposition" || nodeData.name === "ImageComposerPixaroma") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

                // Do NOT change widget.type — ComfyUI uses it for prompt serialization.
                // Changing type to "hidden" causes the widget to be skipped,
                // so the Python node receives the default "{}" instead of actual data.
                const jsonWidget = (this.widgets || []).find(w => w.name === "project_json");
                if (jsonWidget) {
                    jsonWidget.hidden = true;
                    jsonWidget.computeSize = () => [0, -4];
                    if (jsonWidget.element) jsonWidget.element.style.display = "none";
                    requestAnimationFrame(() => {
                        if (jsonWidget.element) jsonWidget.element.style.display = "none";
                        if (jsonWidget.inputEl) jsonWidget.inputEl.style.display = "none";
                    });
                }

                this.addWidget("button", "Open Image Composer", "Open Image Composer", () => {
                    new PixaromaEditor(this);
                });

                createPlaceholder("Image Composer", "Open Image Composer", this, app);
                return r;
            };

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                if (onConfigure) onConfigure.apply(this, arguments);

                const jsonWidget = (this.widgets || []).find(w => w.name === "project_json");
                if (jsonWidget) {
                    jsonWidget.hidden = true;
                    jsonWidget.computeSize = () => [0, -4];
                    if (jsonWidget.element) jsonWidget.element.style.display = "none";
                    requestAnimationFrame(() => {
                        if (jsonWidget.element) jsonWidget.element.style.display = "none";
                        if (jsonWidget.inputEl) jsonWidget.inputEl.style.display = "none";
                    });
                }

                restorePreview(this, "project_json", app);
            };
        }
    }
});
