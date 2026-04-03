// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Editor Framework — Barrel Export                   ║
// ║  Re-exports everything for backward-compatible imports       ║
// ╚═══════════════════════════════════════════════════════════════╝

export { BRAND, UI_ICON, _uiIcon, injectFrameworkStyles } from "./theme.js";
export { createEditorLayout } from "./layout.js";
export {
  createButton,
  createPanel,
  createSliderRow,
  createNumberInput,
  createSelectInput,
  createColorInput,
  createRow,
  createButtonRow,
  createPillGrid,
  createToolButton,
  createToolGrid,
  createCheckbox,
  createDivider,
  createInfo,
  createZoomControls,
  createTransformPanel,
} from "./components.js";
export {
  createLayerItem,
  createLayersList,
  createLayerPanel,
} from "./layers.js";
export {
  createCanvasSettings,
  createCanvasFrame,
  createCanvasToolbar,
} from "./canvas.js";
