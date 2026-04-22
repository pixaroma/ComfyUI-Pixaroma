import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget } from "../shared/index.mjs";

// Locked node dimensions. Height is computed once we know chip + list heights;
// for Task 2 we use a placeholder constant we'll refine in Task 3 / 4.
const NODE_W = 240;
const NODE_H = 320; // placeholder — refined in Task 3 once CSS dictates real heights

const STATE_WIDGET = "ResolutionState";

const DEFAULT_STATE = {
  mode: "preset",
  ratio: "1:1",
  w: 1024,
  h: 1024,
  custom_w: 1024,
  custom_h: 1024,
};

function readState(node) {
  const w = (node.widgets || []).find((x) => x.name === STATE_WIDGET);
  if (!w?.value) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(w.value);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(node, state) {
  const w = (node.widgets || []).find((x) => x.name === STATE_WIDGET);
  if (w) w.value = JSON.stringify(state);
}

app.registerExtension({
  name: "Pixaroma.Resolution",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaResolution") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);

      // Hide the raw JSON widget — JS owns the UI.
      hideJsonWidget(this.widgets, STATE_WIDGET);

      // Lock the node size and disable resize handle.
      this.resizable = false;
      this.size = [NODE_W, NODE_H];

      // Initial state (from saved widget value or default).
      const state = readState(this);
      writeState(this, state); // normalize back so widget value is canonical

      // Empty placeholder DOM widget — Task 3 fills it in.
      const root = document.createElement("div");
      root.style.cssText = `
        width: 100%;
        min-height: 240px;
        background: #1d1d1d;
        border: 1px dashed #444;
        border-radius: 4px;
        color: ${BRAND};
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: 11px;
      `;
      root.textContent = "Resolution UI loading…";

      this.addDOMWidget("resolution_ui", "custom", root, {
        getValue: () => readState(this),
        setValue: (_v) => {}, // we read from the JSON widget, not from this DOM widget value
        getMinHeight: () => 240,
        getMaxHeight: () => 240,
        margin: 4,
      });

      this._pixResRoot = root;
    };

    // Re-clamp on every resize attempt so the node can never grow / shrink.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      this.size[0] = NODE_W;
      this.size[1] = NODE_H;
      if (_origResize) return _origResize.call(this, size);
    };
  },
});
