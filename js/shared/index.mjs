// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared — Barrel Export                             ║
// ╚═══════════════════════════════════════════════════════════════╝

// ── Pixaroma JS bundle version ────────────────────────────────────────────
// MUST stay in lockstep with `version` in pyproject.toml — bump BOTH together
// on every release. The Version Check node compares this (the version baked
// into the JS the BROWSER actually loaded) against the Python files version;
// a mismatch means the browser is running STALE cached code and the user needs
// a hard refresh (Ctrl+Shift+R). It lives in this existing, widely-imported
// module on purpose: a brand-new file is never in anyone's cache, so it could
// never reveal a stale bundle.
export const PIXAROMA_JS_VERSION = "1.4.132";

export {
  allow_debug,
  PIXAROMA_LOGO,
  BRAND,
  formatModelSize,
  createDummyWidget,
  installFocusTrap,
  hideJsonWidget,
  restorePreview,
  resizeNode,
  getLogo,
  createPlaceholder,
  downloadDataURL,
} from "./utils.mjs";

export {
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  clearNodePreview,
  activateNodePreview,
} from "./preview.mjs";

export { injectLabelCSS } from "./label_css.mjs";

export { isVueNodes, applyAdaptiveCanvasOnly, canvasBackingScale, installZoomRepaint } from "./nodes2.mjs";

// Fires when the user flips the Nodes 2.0 setting WITHOUT reloading. Any node
// that builds a different UI per renderer MUST rebuild on this, or it is left
// showing the other renderer's UI (empty body one way, doubled the other).
export { onRendererChange } from "./renderer_switch.mjs";

export { installResizeFloor, measureRootContent } from "./resize_floor.mjs";

export { installCanvasZoomPassthrough } from "./canvas_zoom.mjs";

// Let a text field in a node body keep the browser's Cut/Copy/Paste menu instead
// of ComfyUI's node menu. Call it on the element passed to addDOMWidget.
export { installNativeTextMenu } from "./native_text_menu.mjs";

// Call after a DOM control commits a change to SERIALIZED state. Core snapshots
// the graph on mouseup; a DOM control commits on click, one phase later, so the
// change is otherwise never recorded and the workflow never looks modified.
export { notifyGraphChanged } from "./graph_changed.mjs";

// Node UI convention #27 - a document.body popup must track the canvas zoom and
// grow to fit, or it reads tiny beside a zoomed-in node. Use this for EVERY new
// picker popup rather than re-deriving the traps.
export { placeZoomedPopup, applyPopupZoom, popupZoom } from "./popup_zoom.mjs";

// A read-only numbered gutter for a WRAPPING "one value per line" textarea.
export { attachLineNumbers } from "./line_numbers.mjs";

// Browser mirrors of the Python filename pipeline, for any node with a live
// "Will save as" line. ONE copy on purpose - it took three review rounds to
// agree with _save_helpers.py and a second copy would drift.
export {
  resolveDateTokens,
  expandNativeTokens,
  cleanInputName,
  normalizePath,
  sanitizePrefixMirror,
} from "./filename_mirror.mjs";

// Build every API/asset URL through this. A root-relative "/view?..." works on
// localhost and returns 401 on a hosted ComfyUI. See api_url.mjs.
export { pixApiUrl, pixAsset } from "./api_url.mjs";

export { onNodeDefsRefresh, runRefreshHandlers, installRefreshHook } from "./refresh.mjs";

export { registerSweepProvider, getSweepProvider, sweepProviderFor, anyProviderOwns } from "./sweep_targets.mjs";

export {
  createPixaromaColorPicker,
  openPixaromaColorPickerPopup,
  PIXAROMA_PALETTE,
} from "./color_picker.mjs";

export {
  createHelpButton,
  openHelpPopup,
  openHelpFor,
  closeHelpPopup,
  injectHelpCSS,
  registerNodeHelp,
  getNodeHelp,
  allNodeHelp,
} from "./help.mjs";

export {
  ACC,
  ACCENT_VAR,
  GLOBAL_ACCENT_SETTING,
  DEFAULT_ACCENT_PROP,
  registerNodeSettings,
  registerNodeAccent,
  getNodeSettings,
  openNodeSettings,
  openAccentPanel,
  createAccentSection,
  createOptionRows,
  nodeSetting,
  setNodeSetting,
  closeNodeSettingsPanel,
  closeNodeSettingsFor,
  accentOf,
  accentRgba,
  setNodeAccent,
  applyAccent,
  installNodeAccent,
  repaintAccent,
  repaintAllAccents,
  globalAccent,
  classAccentSetting,
} from "./node_settings.mjs";
