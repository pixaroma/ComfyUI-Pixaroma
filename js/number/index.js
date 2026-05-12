import { app } from "/scripts/app.js";

// Number Pixaroma - keep the node tight on creation (same approach as WH
// Pixaroma). Override computeSize so ComfyUI's auto-layout doesn't leave
// a visible empty band below the single widget. Title + 2 outputs + 1
// widget fits cleanly at TIGHT_H. Users can drag the corner to make it
// bigger if they want.

const TIGHT_H = 80;

app.registerExtension({
  name: "Pixaroma.Number",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaNumber") return;

    const origComputeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function () {
      const base = origComputeSize ? origComputeSize.call(this) : [180, TIGHT_H];
      return [base[0], Math.min(TIGHT_H, base[1] || TIGHT_H)];
    };

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      queueMicrotask(() => {
        const fit = this.computeSize();
        this.size = [fit[0], TIGHT_H];
        this.setDirtyCanvas(true, true);
      });
    };
  },
});
