import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget } from "../shared/index.mjs";

function injectCSS() {
  if (document.getElementById("pixaroma-resolution-css")) return;
  const css = `
    .pix-res-root {
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      color: #ddd;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pix-res-chips {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }
    .pix-res-chip {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 0;
      text-align: center;
      font-size: 10px;
      color: #ccc;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, border-color 0.08s;
    }
    .pix-res-chip:hover { border-color: #666; }
    .pix-res-chip.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-res-chip.span-3 { grid-column: span 3; }
    .pix-res-list {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      min-height: 156px;
      display: flex;
      flex-direction: column;
    }
    .pix-res-row {
      flex: 1;
      padding: 4px 8px;
      border-bottom: 1px solid #2f2f2f;
      font-size: 11px;
      text-align: center;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ui-monospace, monospace;
      color: #ccc;
    }
    .pix-res-row:last-child { border-bottom: none; }
    .pix-res-row.active {
      background: rgba(246,103,68,0.15);
      color: ${BRAND};
      font-weight: 600;
    }
    .pix-res-row.empty {
      cursor: default;
      color: #2a2a2a;
    }
    .pix-res-custom {
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pix-res-custom-row { display: flex; gap: 8px; }
    .pix-res-custom-field { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .pix-res-custom-field label {
      font-size: 9px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }
    .pix-res-custom-field input {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      color: ${BRAND};
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      font-family: ui-monospace, monospace;
      box-sizing: border-box;
      width: 100%;
    }
    .pix-res-custom-field input:focus {
      outline: none;
      border-color: ${BRAND};
    }
    .pix-res-swap {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 5px;
      color: #aaa;
      font-size: 10px;
      cursor: pointer;
    }
    .pix-res-swap:hover { color: #ddd; border-color: #666; }
    .pix-res-readout {
      text-align: center;
      font-size: 10px;
      color: #777;
    }
    .pix-res-readout .accent { color: ${BRAND}; }
  `;
  const style = document.createElement("style");
  style.id = "pixaroma-resolution-css";
  style.textContent = css;
  document.head.appendChild(style);
}
injectCSS();

// Locked node dimensions. Height is computed once we know chip + list heights;
// for Task 2 we use a placeholder constant we'll refine in Task 3 / 4.
const NODE_W = 240;
const NODE_H = 290; // chip grid (3 rows ~32px) + 6-row list (156px) + paddings + title

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

// Chip layout — order matches design spec
const CHIPS = [
  { id: "1:1",    label: "1:1" },
  { id: "16:9",   label: "16:9" },
  { id: "9:16",   label: "9:16" },
  { id: "2:1",    label: "2:1" },
  { id: "3:2",    label: "3:2" },
  { id: "2:3",    label: "2:3" },
  { id: "custom", label: "Custom Resolution", span3: true },
];

function renderChipGrid(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-res-chips";
  for (const c of CHIPS) {
    const el = document.createElement("div");
    el.className = "pix-res-chip" + (c.span3 ? " span-3" : "");
    el.textContent = c.label;
    el.dataset.chipId = c.id;
    const isActive =
      (c.id === "custom" && state.mode === "custom") ||
      (c.id !== "custom" && state.mode === "preset" && state.ratio === c.id);
    if (isActive) el.classList.add("active");
    wrap.appendChild(el);
  }
  return wrap;
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

      // Build the UI: chip grid + (empty) list placeholder. Task 4 fills the list, Task 5 swaps it for Custom.
      const root = document.createElement("div");
      root.className = "pix-res-root";
      root.appendChild(renderChipGrid(state));
      // Empty list placeholder for Task 4
      const listPlaceholder = document.createElement("div");
      listPlaceholder.className = "pix-res-list";
      root.appendChild(listPlaceholder);

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
