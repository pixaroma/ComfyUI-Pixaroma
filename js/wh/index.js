import { app } from "/scripts/app.js";

// WH Pixaroma - keep the node small on creation. Native ComfyUI auto-sizes
// nodes a bit generously, leaving an empty gap between the title and the
// first output slot. We override the default size to something compact
// that fits the two outputs + two INT widgets cleanly. Users can still
// drag-resize larger if they want.

const DEFAULT_W = 200;
const DEFAULT_H = 130;

app.registerExtension({
  name: "Pixaroma.WH",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaWH") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      // Only set the default for fresh nodes, not nodes restored from a
      // saved workflow (those carry their own this.size from the JSON).
      // We detect "fresh" by checking if onConfigure has not run yet -
      // saved nodes get their size set during configure.
      this.size = [DEFAULT_W, DEFAULT_H];
      this.setDirtyCanvas(true, true);
    };
  },
});
