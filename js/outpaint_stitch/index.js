import { app } from "/scripts/app.js";
import { CLASS, BRAND, ACCENT_SETTING, ACCENT_PROP } from "./core.mjs";
import {
  injectCSS, installSliders, uninstallSliders, paintRoot, MIN_W, DEFAULT_W,
} from "./sliders.mjs";
import { openOpsPanel, closeOpsPanelFor } from "./settings.mjs";

// Outpaint Stitch Pixaroma - gives the two native INT widgets (feather,
// color_match) the recess-slider look of Sliders Pixaroma, plus a per-node
// accent colour (right-click -> Slider colour, with a global default). The
// native widgets stay the source of truth, so the Python contract is untouched.

app.registerExtension({
  name: "Pixaroma.OutpaintStitch",

  // A plain hex field: ComfyUI's settings dialog has no colour input, and the
  // pretty picker lives in the node's own panel anyway (which also writes this
  // value via its "Colour as default" button).
  settings: [
    {
      id: ACCENT_SETTING,
      name: "Default slider colour (hex)",
      type: "text",
      defaultValue: BRAND,
      tooltip: "The colour new Outpaint Stitch sliders paint with, e.g. #f66744. Each node can override it in its own settings.",
      category: ["👑 Pixaroma", "Outpaint Stitch"],
      onChange: () => {
        try {
          for (const n of app.graph?._nodes || []) {
            if (n?.comfyClass === CLASS && !n.properties?.[ACCENT_PROP]) paintRoot(n);
          }
        } catch {}
      },
    },
  ],

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixOpsPatched) return;   // hot-reload guard
    nodeType.prototype._pixOpsPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      installSliders(this);
      // Fresh default width (configure() restores the saved size for loaded /
      // duplicated nodes, running AFTER this - Vue Compat #8).
      if (!this.size || this.size[0] < MIN_W) this.size[0] = DEFAULT_W;
      queueMicrotask(() => paintRoot(this));   // pick up restored widget values
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _configure?.apply(this, arguments);
      installSliders(this);                    // idempotent - repaints if built
      queueMicrotask(() => paintRoot(this));
      return r;
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeOpsPanelFor(this);
      uninstallSliders(this);
      return _removed?.apply(this, arguments);
    };
  },

  // Right-click (the current context-menu API, so it shows in both renderers).
  getNodeMenuItems(node) {
    if (node?.comfyClass !== CLASS) return [];
    return [
      {
        content: "⚙ Slider colour",
        callback: () => openOpsPanel(node, () => paintRoot(node)),
      },
    ];
  },
});
