import { app } from "/scripts/app.js";

// Text Pixaroma - bigger default size so the multi-line text field has
// enough room out of the box for typical prompts. Users can drag the
// corner to make it bigger or smaller; the textarea fills whatever
// space the node has.

const DEFAULT_W = 400;
const DEFAULT_H = 220;

app.registerExtension({
  name: "Pixaroma.Text",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaText") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      queueMicrotask(() => {
        this.size = [DEFAULT_W, DEFAULT_H];
        this.setDirtyCanvas(true, true);
      });
    };
  },
});
