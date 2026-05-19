import { app } from "/scripts/app.js";

// ── Pixaroma node colors: right-click menu entry ─────────────────────────
// Adds two items to the standard node right-click menu so the user can
// paint ANY ComfyUI node (not just Pixaroma's) in the brand dark style:
//   • 👑 Apply Pixaroma colors  → sets node.color + node.bgcolor
//   • Reset node colors         → clears the override
//
// The colors are written to the node's own properties, so they are
// serialized into the workflow JSON. Anyone receiving the workflow sees
// the colors WITHOUT needing this plugin installed.
//
// Multi-select aware: if multiple nodes are selected AND the right-click
// target is one of them, the action applies to all of them. The menu
// label updates to reflect the count, e.g. "👑 Apply Pixaroma colors to
// 4 nodes".

const TITLE_BAR_COLOR = "#1d1d1d";
const BODY_COLOR      = "#2a2a2a";

function getTargetNodes(currentNode) {
  const sel = app.canvas?.selected_nodes;
  if (sel) {
    const nodes = Object.values(sel);
    if (nodes.length > 1 && nodes.includes(currentNode)) return nodes;
  }
  return [currentNode];
}

function applyPixaromaColors(nodes) {
  for (const n of nodes) {
    n.color   = TITLE_BAR_COLOR;
    n.bgcolor = BODY_COLOR;
  }
  app.graph?.setDirtyCanvas(true, true);
}

function resetColors(nodes) {
  for (const n of nodes) {
    delete n.color;
    delete n.bgcolor;
  }
  app.graph?.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "Pixaroma.NodeColors",
  async setup() {
    if (typeof LGraphCanvas === "undefined" || !LGraphCanvas?.prototype?.getNodeMenuOptions) {
      return;
    }
    const origGetNodeMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions;
    LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
      const options = origGetNodeMenuOptions.apply(this, arguments);
      const targets = getTargetNodes(node);
      const count   = targets.length;
      const applyLabel = count > 1
        ? `👑 Apply Pixaroma colors to ${count} nodes`
        : "👑 Apply Pixaroma colors";
      const resetLabel = count > 1
        ? `Reset colors on ${count} nodes`
        : "Reset node colors";
      options.push(
        null,
        { content: applyLabel, callback: () => applyPixaromaColors(targets) },
        { content: resetLabel, callback: () => resetColors(targets) }
      );
      return options;
    };
  },
});
