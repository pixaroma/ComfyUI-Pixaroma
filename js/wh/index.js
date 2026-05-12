import { app } from "/scripts/app.js";

// WH Pixaroma - keep the node tight on creation. ComfyUI's auto-computed
// minimum size has a built-in vertical buffer that leaves visible empty
// space below the widgets on a small node like this. We override
// computeSize to a tight minimum (just enough for title + 2 outputs +
// 2 INT widgets) and set the initial size to match, so a fresh node
// renders with no leftover space. Width auto-grows from the original
// computeSize so the title text never gets clipped. Users can still
// drag the corner to make the node bigger.

const TIGHT_H = 130;

app.registerExtension({
  name: "Pixaroma.WH",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaWH") return;

    // Override the minimum-size calculation. If we don't shrink the minimum,
    // ComfyUI bumps `this.size[1]` back up to its default and leaves the
    // unfilled space below the widgets visible.
    const origComputeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function () {
      const base = origComputeSize ? origComputeSize.call(this) : [200, TIGHT_H];
      // Keep auto-computed width (so the title text still fits) but cap
      // the minimum height to our tight value.
      return [base[0], Math.min(TIGHT_H, base[1] || TIGHT_H)];
    };

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      // Defer one tick so the widgets are fully registered before we
      // read computeSize - otherwise the width might still be the
      // pre-widgets default.
      queueMicrotask(() => {
        const fit = this.computeSize();
        this.size = [fit[0], TIGHT_H];
        this.setDirtyCanvas(true, true);
      });
    };
  },
});
