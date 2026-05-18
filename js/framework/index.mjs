// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Editor Framework — Barrel Export                   ║
// ║  Re-exports everything for backward-compatible imports       ║
// ╚═══════════════════════════════════════════════════════════════╝

export { BRAND, UI_ICON, _uiIcon, injectFrameworkStyles } from "./theme.mjs";
export { createEditorLayout } from "./layout.mjs";
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
} from "./components.mjs";
export {
  createLayerItem,
  createLayersList,
  createLayerPanel,
} from "./layers.mjs";
export {
  createCanvasSettings,
  createCanvasFrame,
  createCanvasToolbar,
} from "./canvas.mjs";

// Text Overlay infrastructure (used by Text Overlay node + future Composer text layers)
export {
  getFontCatalog,
  resolveFontVariant,
  ensureFontLoaded,
  canvasFontString,
  loadFontForLayer,
} from "./fonts.mjs";
export { renderTextLayer } from "./text_render.mjs";
export { createTextEditorPanel } from "./text_editor.mjs";
