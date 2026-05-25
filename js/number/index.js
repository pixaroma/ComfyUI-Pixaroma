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
      // Tight default for FRESH nodes only. Assign SYNCHRONOUSLY: configure()
      // runs AFTER onNodeCreated (Vue Compat #8) on workflow load / tab switch
      // / duplicate and restores the user's saved size. A queueMicrotask here
      // would fire AFTER configure() and clobber the saved size back to the
      // tight auto-default — the resize-persistence trap (Pixaroma UI
      // convention #9). Mutate size[0]/[1] rather than replacing the array.
      const fit = this.computeSize();
      this.size[0] = fit[0];
      this.size[1] = TIGHT_H;
      this.setDirtyCanvas(true, true);
    };
  },
});
