// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Editor Framework — Theme & CSS Injection           ║
// ║  Brand colors, CSS custom properties, and shared stylesheet  ║
// ╚═══════════════════════════════════════════════════════════════╝

/** Brand accent color hex — re-exported for editor-specific use. */
export const BRAND = "#f66744";

/** Base path for UI icon SVGs served by the Pixaroma backend. */
export const UI_ICON = "/pixaroma/assets/icons/ui/";

/**
 * Creates an <img> element pointing to a UI icon SVG.
 * @param {string} name - Filename inside the UI icons folder (e.g. "save.svg")
 * @param {number} [size=14] - Width and height in px
 * @returns {HTMLImageElement}
 */
export function _uiIcon(name, size = 14) {
  const img = document.createElement("img");
  img.src = "/pixaroma/assets/icons/ui/" + name;
  img.style.cssText = `width:${size}px;height:${size}px;pointer-events:none;`;
  img.draggable = false;
  return img;
}

/** ID used for the injected <style> element — prevents duplicate injection. */
const STYLE_ID = "pixaroma-framework-v1";

// ═════════════════════════════════════════════════════════════════
//  CSS Injection
// ═════════════════════════════════════════════════════════════════

export function injectFrameworkStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
/* ═══════════════════════════════════════════════════════
   Pixaroma Editor Framework — Shared Stylesheet
   ═══════════════════════════════════════════════════════ */

/* ── CSS Custom Properties ──────────────────────────── */
.pxf-overlay {
  --pxf-accent: #f66744;
  --pxf-accent-hover: #e05535;
  --pxf-bg-darkest: #131415;
  --pxf-bg-dark: #171718;
  --pxf-bg-sidebar: #181a1b;
  --pxf-bg-panel: #242628;
  --pxf-bg-input: #111;
  --pxf-bg-btn: #353535;
  --pxf-border: #3a3d40;
  --pxf-border-subtle: #2a2c2e;
  --pxf-border-titlebar: #2e3033;
  --pxf-text: #e0e0e0;
  --pxf-text-dim: #888;
  --pxf-text-dimmer: #666;
  --pxf-text-label: #999;
  --pxf-select-bg: #2a1800;
  --pxf-select-border: #f66744;
  --pxf-multi-bg: #0a1a2a;
  --pxf-multi-border: #0ea5e9;
  --pxf-danger: #d46060;
  --pxf-danger-bg: #2a1a1a;
  --pxf-font: 'Segoe UI', system-ui, sans-serif;
  --pxf-font-mono: monospace;
}

/* ── Overlay (fullscreen editor) ────────────────────── */
.pxf-overlay {
  position: fixed; inset: 0; z-index: 11000;
  display: flex; flex-direction: column;
  background: var(--pxf-bg-dark);
  font-family: var(--pxf-font);
  color: var(--pxf-text);
  overflow: hidden; user-select: none;
}

/* ── Titlebar ───────────────────────────────────────── */
.pxf-titlebar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; background: var(--pxf-bg-darkest);
  border-bottom: 1px solid var(--pxf-border-titlebar);
  flex-shrink: 0; height: 38px;
}
.pxf-title {
  color: #fff; font-size: 13px; font-weight: bold;
  display: flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.pxf-title-brand { color: var(--pxf-accent); }
.pxf-title-logo { width: 20px; height: 20px; }
.pxf-titlebar-center {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  min-width: 0;
}
.pxf-titlebar-actions {
  display: flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.pxf-titlebar-zoom {
  display: flex; align-items: center; gap: 3px;
  background: rgba(255,255,255,0.05); border: 1px solid var(--pxf-border);
  border-radius: 5px; padding: 2px 4px;
}
.pxf-titlebar-zoom .pxf-zoom-label {
  font-size: 10px; color: var(--pxf-text-dim);
  min-width: 36px; text-align: center;
}
.pxf-titlebar-sep {
  width: 1px; height: 18px; background: var(--pxf-border); flex-shrink: 0;
  margin: 0 4px;
}

/* ── Top options bar (below titlebar, e.g. Paint brush opts) ── */
.pxf-top-options {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 4px 10px; background: var(--pxf-bg-darkest);
  border-bottom: 1px solid var(--pxf-border-subtle);
  flex-shrink: 0; min-height: 34px;
}

/* ── Body (sidebars + workspace) ────────────────────── */
.pxf-body {
  display: flex; flex: 1; overflow: hidden; min-height: 0;
}

/* ── Sidebars ───────────────────────────────────────── */
.pxf-sidebar {
  flex-shrink: 0; background: var(--pxf-bg-sidebar);
  display: flex; flex-direction: column;
  overflow-y: auto; overflow-x: hidden;
  scrollbar-gutter: stable;
  position: relative; z-index: 5;
}
.pxf-sidebar-left { border-right: 1px solid var(--pxf-border-subtle); }
.pxf-sidebar-right { border-left: 1px solid var(--pxf-border-subtle); overflow-y: hidden; }

/* Sidebar scrollbar */
.pxf-sidebar::-webkit-scrollbar { width: 5px; }
.pxf-sidebar::-webkit-scrollbar-track { background: var(--pxf-bg-input); }
.pxf-sidebar::-webkit-scrollbar-thumb { background: var(--pxf-border); border-radius: 3px; }
.pxf-sidebar::-webkit-scrollbar-thumb:hover { background: var(--pxf-accent); }

/* ── Workspace (center canvas area) ─────────────────── */
.pxf-workspace {
  flex: 1; position: relative; overflow: hidden;
  background: #111315;
  display: flex; align-items: center; justify-content: center;
}

/* Sidebar footer (save/close/help — always at bottom) */
.pxf-sidebar-footer {
  padding: 10px 12px; margin-top: auto;
  border-top: 1px solid var(--pxf-border-titlebar);
  display: flex; flex-direction: column; gap: 6px;
  flex-shrink: 0;
}

/* ── Tool info (floating tooltip in workspace, bottom-left) ── */
.pxf-tool-info {
  position: absolute; bottom: 10px; left: 10px;
  background: rgba(0,0,0,0.75); color: #ccc;
  padding: 5px 12px; border-radius: 5px;
  font-size: 10px; font-family: var(--pxf-font-mono);
  pointer-events: none; z-index: 5;
  max-width: 80%;
  transition: color 0.15s ease;
}
.pxf-tool-info.warn { color: #f66744; }
.pxf-tool-info.error { color: #f08080; }

/* ── Panel / Section ────────────────────────────────── */
.pxf-panel {
  padding: 8px 10px;
  border-bottom: 1px solid var(--pxf-border-subtle);
}
.pxf-panel-title {
  font-size: 9px; color: var(--pxf-accent); font-weight: bold;
  text-transform: uppercase; letter-spacing: .06em;
  margin-bottom: 6px; cursor: default;
  display: flex; align-items: center; gap: 4px;
}
.pxf-panel-title-arrow {
  font-size: 8px; transition: transform .15s; display: inline-block;
}
.pxf-panel.collapsed .pxf-panel-title-arrow { transform: rotate(-90deg); }
.pxf-panel.collapsed .pxf-panel-content { display: none; }
.pxf-panel-title.clickable { cursor: pointer; }
.pxf-panel-title.clickable:hover { color: #fff; }

/* ── Buttons ────────────────────────────────────────── */
.pxf-btn, .pxf-btn-full, .pxf-btn-sm {
  font-family: inherit; cursor: pointer;
  border-radius: 5px; border: 1px solid var(--pxf-border);
  transition: all .15s ease; white-space: nowrap;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
}
.pxf-btn:disabled, .pxf-btn-full:disabled, .pxf-btn-sm:disabled {
  opacity: 0.35; cursor: default; pointer-events: none;
}
.pxf-btn img, .pxf-btn-full img, .pxf-btn-sm img {
  width: 14px; height: 14px; filter: brightness(0) invert(0.7);
  pointer-events: none;
}
.pxf-btn:hover img, .pxf-btn-full:hover img, .pxf-btn-sm:hover img {
  filter: brightness(0) invert(1);
}

.pxf-btn {
  background: var(--pxf-bg-btn); color: #ccc;
  padding: 6px 14px; font-size: 12px;
}
.pxf-btn:hover { background: #2e3033; color: var(--pxf-accent); border-color: var(--pxf-accent); }

.pxf-btn.pxf-btn-accent, .pxf-btn-accent {
  background: var(--pxf-accent); border-color: var(--pxf-accent);
  color: #fff; font-weight: bold;
}
.pxf-btn.pxf-btn-accent:hover, .pxf-btn-accent:hover {
  background: var(--pxf-accent-hover); border-color: var(--pxf-accent-hover);
}
.pxf-btn-accent img { filter: brightness(0) invert(1); }

.pxf-btn.pxf-btn-danger, .pxf-btn-full.pxf-btn-danger, .pxf-btn-sm.pxf-btn-danger {
  background: #1e2022 !important; color: #ccc !important;
  border-color: #d93523 !important;
}
.pxf-btn.pxf-btn-danger:hover, .pxf-btn-full.pxf-btn-danger:hover, .pxf-btn-sm.pxf-btn-danger:hover {
  background: #d93523 !important; color: #fff !important;
  border-color: #d93523 !important;
}
.pxf-btn-danger img, .pxf-btn-danger svg {
  filter: none !important;
}
.pxf-btn-danger:hover img, .pxf-btn-danger:hover svg {
  filter: brightness(0) invert(1) !important;
}

.pxf-btn-full {
  width: 100%; padding: 7px 10px; font-size: 11px;
  background: #1e2022; color: #ccc;
}
.pxf-btn-full:hover { background: #2e3033; color: var(--pxf-accent); border-color: var(--pxf-accent); }

.pxf-btn-sm {
  min-width: 28px; height: 28px; padding: 0 4px; flex-shrink: 0;
  background: var(--pxf-bg-panel); color: #ccc; font-size: 13px;
}
.pxf-btn-sm:hover { background: #2e3033; color: var(--pxf-accent); border-color: var(--pxf-accent); }

.pxf-btn-icon {
  background: none; border: none; color: #ccc; padding: 4px;
  cursor: pointer; font-size: 16px; border-radius: 4px; transition: all .15s;
  display: inline-flex; align-items: center; justify-content: center;
}
.pxf-btn-icon:hover { color: var(--pxf-accent); background: rgba(255,255,255,0.05); }
.pxf-btn-icon:disabled { opacity: 0.3; cursor: default; pointer-events: none; }

.pxf-btn-row { display: flex; gap: 6px; }
.pxf-btn-row > .pxf-btn, .pxf-btn-row > .pxf-btn-full { flex: 1; }

.pxf-btn.active { background: var(--pxf-accent); border-color: var(--pxf-accent); color: #fff; }
.pxf-btn.active img { filter: brightness(0) invert(1); }

/* ── Pill grid ─────────────────────────────────────── */
.pxf-pill-grid { display: grid; gap: 4px; }
.pxf-pill {
  font-size: 10px; background: #1e2022; border: 1px solid var(--pxf-border);
  color: #aaa; border-radius: 3px; padding: 4px 0; cursor: pointer;
  transition: all .1s; text-align: center; font-family: inherit;
}
.pxf-pill:hover { background: #444; color: #fff; }
.pxf-pill.active { background: var(--pxf-accent); border-color: var(--pxf-accent); color: #fff; }

/* ── Slider row ─────────────────────────────────────── */
.pxf-slider-row {
  display: flex; align-items: center; gap: 5px; margin-bottom: 5px;
}
.pxf-slider-label {
  font-size: 10px; color: var(--pxf-text-dim); flex-shrink: 0;
}
.pxf-slider-row input[type=number] {
  width: 48px; background: var(--pxf-bg-input); color: var(--pxf-text);
  border: 1px solid var(--pxf-border); border-radius: 4px;
  padding: 3px 4px; font-size: 10px; font-family: var(--pxf-font-mono);
  flex-shrink: 0; text-align: center;
}
.pxf-slider-row input[type=number]:focus {
  border-color: var(--pxf-accent); outline: none;
}

/* ── Unified slider styling ──────────────────────────── */
.pxf-overlay input[type=range] {
  -webkit-appearance: none; appearance: none;
  flex: 1; min-width: 0; height: 6px; cursor: pointer;
  background: linear-gradient(to right,
    var(--pxf-accent) 0%, var(--pxf-accent) var(--pxf-fill, 50%),
    var(--pxf-border) var(--pxf-fill, 50%), var(--pxf-border) 100%);
  border-radius: 3px; border: none; outline: none;
}
.pxf-overlay input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--pxf-accent); border: none;
  box-shadow: 0 0 3px rgba(0,0,0,0.5);
  cursor: pointer; margin-top: -3px;
}
.pxf-overlay input[type=range]::-moz-range-thumb {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--pxf-accent); border: none;
  box-shadow: 0 0 3px rgba(0,0,0,0.5);
  cursor: pointer;
}
.pxf-overlay input[type=range]::-webkit-slider-runnable-track {
  height: 6px; border-radius: 3px; background: transparent;
}
.pxf-overlay input[type=range]::-moz-range-track {
  height: 6px; border-radius: 3px; background: transparent;
}
.pxf-overlay input[type=range]::-moz-range-progress {
  height: 6px; border-radius: 3px; background: var(--pxf-accent);
}

/* ── Number input ───────────────────────────────────── */
.pxf-input-num {
  width: 55px; background: var(--pxf-bg-input); color: var(--pxf-text);
  border: 1px solid var(--pxf-border); border-radius: 3px;
  padding: 3px 4px; font-size: 10px; font-family: var(--pxf-font-mono);
  text-align: center;
}

/* ── Select dropdown ────────────────────────────────── */
.pxf-select {
  background: var(--pxf-bg-input); color: var(--pxf-text);
  border: 1px solid var(--pxf-border); border-radius: 4px;
  padding: 4px 6px; font-size: 11px; font-family: inherit;
  cursor: pointer; width: 100%;
}

/* ── Color input ────────────────────────────────────── */
.pxf-color-input {
  width: 50px; height: 22px; cursor: pointer;
  border: 1px solid var(--pxf-border); border-radius: 4px;
  background: var(--pxf-bg-input); padding: 0;
}

/* ── Row (label + content) ──────────────────────────── */
.pxf-row {
  display: flex; align-items: center; gap: 6px; margin-bottom: 5px;
}
.pxf-row-label {
  font-size: 10px; color: var(--pxf-text-dim); flex-shrink: 0;
}

/* ── Button row ─────────────────────────────────────── */
.pxf-btn-row { display: flex; gap: 6px; }

/* ── Tool button ────────────────────────────────────── */
.pxf-tool-btn {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 1px;
  height: 38px; background: #1c1e1f; border: 1px solid var(--pxf-border);
  color: #ccc; border-radius: 4px; cursor: pointer;
  font-family: inherit; font-size: 10px; transition: all .12s;
  padding: 2px;
}
.pxf-tool-btn:hover { background: #2e3033; color: #fff; border-color: #555; }
.pxf-tool-btn.active { background: var(--pxf-accent); border-color: var(--pxf-accent); color: #fff; }
.pxf-tool-btn-icon { font-size: 14px; line-height: 1; }
.pxf-tool-btn-label { font-size: 8px; line-height: 1; }

/* ── Tool grid ──────────────────────────────────────── */
.pxf-tool-grid { display: grid; gap: 4px; }

/* ── Layer Panel (unified Photoshop-style) ──────────── */
.pxf-layer-panel {
  display: flex; flex-direction: column; min-height: 0; flex: 1;
}
.pxf-layer-blend-row {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; border-bottom: 1px solid var(--pxf-border-subtle);
}
.pxf-layer-blend-select {
  flex: 1; background: var(--pxf-bg-input); color: var(--pxf-text);
  border: 1px solid var(--pxf-border); border-radius: 4px;
  padding: 4px 6px; font-size: 11px; font-family: inherit;
}
.pxf-layer-opacity-row {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 8px; border-bottom: 1px solid var(--pxf-border-subtle);
}
.pxf-layer-opacity-label {
  font-size: 9px; color: var(--pxf-text-dim); flex-shrink: 0;
}
.pxf-layer-opacity-row input[type=number] {
  width: 42px; background: var(--pxf-bg-input); color: var(--pxf-text);
  border: 1px solid var(--pxf-border); border-radius: 4px;
  padding: 3px 4px; font-size: 10px; font-family: var(--pxf-font-mono);
  text-align: center; flex-shrink: 0;
}
.pxf-layer-opacity-row input[type=number]:focus {
  border-color: var(--pxf-accent); outline: none;
}

/* Layer list */
.pxf-layers-list {
  overflow-y: auto; min-height: 40px; flex: 1;
  padding: 2px 0;
}
.pxf-layers-resize {
  height: 1px; background: var(--pxf-border-subtle); flex-shrink: 0;
}
.pxf-layers-list::-webkit-scrollbar { width: 4px; }
.pxf-layers-list::-webkit-scrollbar-track { background: transparent; }
.pxf-layers-list::-webkit-scrollbar-thumb { background: var(--pxf-border); border-radius: 2px; }

/* Layer item */
.pxf-layer-item {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 6px; border-radius: 4px;
  border: 1px solid transparent; cursor: pointer;
  font-size: 11px; transition: background .1s;
  min-height: 30px;
}
.pxf-layer-item:hover { background: rgba(255,255,255,0.04); }
.pxf-layer-item.active {
  background: var(--pxf-select-bg); border-color: var(--pxf-select-border);
}
.pxf-layer-item.multi-selected {
  background: var(--pxf-multi-bg); border-color: var(--pxf-multi-border);
}
.pxf-layer-item.drag-over-top { border-top: 2px solid var(--pxf-accent); }
.pxf-layer-item.drag-over-bottom { border-bottom: 2px solid var(--pxf-accent); }
.pxf-layer-item.dragging { opacity: 0.35; }

/* Layer icon buttons (eye, lock) */
.pxf-layer-icon {
  width: 16px; height: 16px; flex-shrink: 0; cursor: pointer;
  opacity: 0.5; transition: opacity .15s;
  display: flex; align-items: center; justify-content: center;
}
.pxf-layer-icon:hover { opacity: 1; }
.pxf-layer-icon img {
  width: 12px; height: 12px; display: block;
  filter: brightness(0) invert(0.7);
}
.pxf-layer-icon:hover img { filter: brightness(0) invert(1); }
.pxf-layer-item.active .pxf-layer-icon img { filter: brightness(0) invert(0.9); }

/* Layer thumbnail */
.pxf-layer-thumb {
  width: 28px; height: 28px; flex-shrink: 0; border-radius: 3px;
  background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 8px 8px;
  overflow: hidden; border: 1px solid rgba(255,255,255,0.06);
}

/* Layer name */
.pxf-layer-name {
  flex: 1; font-size: 11px; color: #ccc;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 2px 4px; min-width: 0;
}
.pxf-layer-name-input {
  flex: 1; background: var(--pxf-bg-input); color: var(--pxf-text);
  border: 1px solid var(--pxf-accent); border-radius: 3px;
  font-size: 11px; padding: 2px 6px; outline: none;
  font-family: inherit; min-width: 0;
}

/* Action bar (add, dup, delete, up, down, merge) */
.pxf-layers-actions {
  display: flex; gap: 2px; padding: 5px 4px;
  border-top: 1px solid var(--pxf-border-subtle);
  justify-content: center;
}
.pxf-layer-action-btn {
  width: 28px; height: 28px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--pxf-bg-panel); border: 1px solid var(--pxf-border);
  border-radius: 4px; cursor: pointer; transition: all .12s;
}
.pxf-layer-action-btn:hover {
  background: #2e3033; border-color: var(--pxf-accent);
}
.pxf-layer-action-btn:disabled { opacity: 0.3; cursor: default; pointer-events: none; }
.pxf-layer-action-btn img {
  width: 14px; height: 14px; display: block;
  filter: brightness(0) invert(0.7);
}
.pxf-layer-action-btn:hover img { filter: brightness(0) invert(1); }
.pxf-layer-action-btn.danger { border-color: #d93523; }
.pxf-layer-action-btn.danger:hover {
  background: #d93523; border-color: #d93523;
}
.pxf-layer-action-btn.danger:hover img {
  filter: brightness(0) invert(1) !important;
}

/* ── Canvas Toolbar (Add Image, BG Color, Clear) ───── */
.pxf-canvas-toolbar {
  display: flex; flex-direction: column; gap: 5px;
  padding: 8px 10px; border-bottom: 1px solid var(--pxf-border-subtle);
}
.pxf-canvas-toolbar-row {
  display: flex; align-items: center; gap: 6px;
}
.pxf-canvas-toolbar .pxf-btn-full {
  font-size: 11px; padding: 6px 8px;
}
/* Drag & drop overlay on workspace */
.pxf-drop-overlay {
  display: none; position: absolute; inset: 0; z-index: 50;
  background: rgba(246, 103, 68, 0.08);
  border: 3px dashed var(--pxf-accent);
  border-radius: 8px;
  pointer-events: none;
  align-items: center; justify-content: center;
}
.pxf-drop-overlay.active { display: flex; }
.pxf-drop-label {
  background: rgba(0,0,0,0.7); color: var(--pxf-accent);
  padding: 12px 24px; border-radius: 8px;
  font-size: 14px; font-weight: bold;
}

/* ── Help overlay (unified modal, 2-column layout) ───── */
.pxf-help-overlay {
  display: none; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: #171718; border: 1px solid var(--pxf-accent);
  border-radius: 10px; padding: 0;
  width: 960px; max-width: 95%; max-height: 86vh;
  z-index: 100; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
  font-family: var(--pxf-font);
}
.pxf-help-header {
  display: flex; align-items: center; padding: 14px 20px;
  border-bottom: 1px solid #2a2a2a;
}
.pxf-help-header h3 { flex: 1; color: var(--pxf-accent); font-size: 14px; margin: 0; font-weight: 600; }
.pxf-help-content {
  padding: 18px 24px; overflow-y: auto;
  max-height: calc(86vh - 110px);
  font-size: 11px; line-height: 1.7; color: #ccc;
  column-count: 2; column-gap: 36px;
}
.pxf-help-section {
  break-inside: avoid; margin-bottom: 14px;
}
.pxf-help-section:last-child { margin-bottom: 0; }
.pxf-help-section h4 {
  color: var(--pxf-accent);
  margin: 0 0 6px 0; font-size: 11px; font-weight: 700;
  letter-spacing: 0.6px; text-transform: uppercase;
}
.pxf-help-grid {
  display: grid; grid-template-columns: max-content 1fr;
  gap: 3px 14px;
}
.pxf-help-grid b { color: #eee; white-space: nowrap; font-weight: 600; }
.pxf-help-grid span { color: #bbb; }
.pxf-help-content kbd {
  background: #2a2c2e; border: 1px solid #444; border-radius: 3px;
  padding: 1px 5px; font-size: 10px; color: var(--pxf-text);
  font-family: var(--pxf-font-mono, monospace);
}
.pxf-help-content b { color: #eee; }
.pxf-help-footer {
  padding: 10px 20px; border-top: 1px solid #2a2a2a;
  font-size: 10px; color: #666; text-align: center; line-height: 1.6;
  flex-shrink: 0;
}
.pxf-help-footer a { color: var(--pxf-accent); text-decoration: none; }
.pxf-help-footer a:hover { text-decoration: underline; }

/* ── Zoom controls ──────────────────────────────────── */
.pxf-zoom-bar {
  position: absolute; bottom: 8px; left: 50%;
  transform: translateX(-50%);
  display: flex; align-items: center; gap: 4px;
  background: rgba(20,20,22,0.85); border: 1px solid var(--pxf-border);
  border-radius: 6px; padding: 3px 6px;
}
.pxf-zoom-label {
  font-size: 10px; color: var(--pxf-text-dim);
  min-width: 36px; text-align: center;
}

/* ── Checkbox ───────────────────────────────────────── */
.pxf-check-row {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: 11px; color: #ccc;
}
.pxf-check-row input[type=checkbox] { accent-color: var(--pxf-accent); }

/* ── Divider ────────────────────────────────────────── */
.pxf-divider {
  height: 1px; background: var(--pxf-border-subtle);
  margin: 6px 0; flex-shrink: 0;
}

/* ── Info text ──────────────────────────────────────── */
.pxf-info { font-size: 10px; color: var(--pxf-text-dim); line-height: 1.6; }
.pxf-info b { color: #ccc; font-weight: 600; }

/* ── Canvas Frame (orange border + dimension label + gray masks) ── */
.pxf-canvas-frame {
  position: absolute; pointer-events: none; z-index: 2;
  box-sizing: border-box;
  border: 2px solid rgba(249, 115, 22, 0.45);
}
.pxf-canvas-frame-label {
  position: absolute; bottom: -18px; right: 0;
  font-size: 12px; color: rgba(249, 115, 22, 0.6);
  font-family: var(--pxf-font-mono); white-space: nowrap;
  transform-origin: bottom right;
}
.pxf-canvas-mask {
  position: absolute; pointer-events: none; z-index: 1;
  background: rgba(0, 0, 0, 0.4);
}

/* ── Canvas Settings component ──────────────────────── */
.pxf-canvas-settings { display: flex; flex-direction: column; gap: 6px; }
.pxf-ratio-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.pxf-ratio-btn {
  font-size: 10px; background: #1e2022; border: 1px solid var(--pxf-border);
  color: #aaa; border-radius: 4px; padding: 5px 0; cursor: pointer;
  transition: all .12s; text-align: center; font-family: inherit;
  font-weight: 500;
}
.pxf-ratio-btn:hover { background: #444; color: #fff; border-color: #555; }
.pxf-ratio-btn.active {
  background: var(--pxf-accent); border-color: var(--pxf-accent); color: #fff;
}
.pxf-size-row {
  display: flex; align-items: center; gap: 4px;
}
.pxf-size-input {
  flex: 1; background: var(--pxf-bg-input); color: var(--pxf-text);
  border: 1px solid var(--pxf-border); border-radius: 4px;
  padding: 5px 6px; font-size: 11px; font-family: var(--pxf-font-mono);
  text-align: center; min-width: 0;
}
.pxf-size-label {
  font-size: 9px; color: var(--pxf-text-dim); width: 14px; flex-shrink: 0;
  text-align: center;
}
.pxf-size-x { font-size: 10px; color: var(--pxf-text-dimmer); flex-shrink: 0; }
.pxf-swap-btn {
  width: 100%; padding: 5px; font-size: 11px; text-align: center;
  background: #1e2022; border: 1px solid var(--pxf-border); color: #aaa;
  border-radius: 4px; cursor: pointer; transition: all .12s; font-family: inherit;
}
.pxf-swap-btn:hover { background: var(--pxf-accent); border-color: var(--pxf-accent); color: #fff; }
  `;
  document.head.appendChild(s);

  // ── Slider Fill System ──────────────────────────────────────
  if (!window._pxfSliderFillInit) {
    window._pxfSliderFillInit = true;
    window._pxfUpdateFill = function (input) {
      const mn = parseFloat(input.min) || 0,
        mx = parseFloat(input.max) || 100;
      const v = parseFloat(input.value) || 0;
      input.style.setProperty(
        "--pxf-fill",
        Math.max(0, Math.min(100, ((v - mn) / (mx - mn)) * 100)) + "%",
      );
    };
    document.addEventListener("input", (e) => {
      if (e.target.type === "range" && e.target.closest(".pxf-overlay"))
        window._pxfUpdateFill(e.target);
    });
    const desc = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    const origSet = desc.set;
    desc.set = function (v) {
      origSet.call(this, v);
      if (this.type === "range" && this.closest(".pxf-overlay"))
        window._pxfUpdateFill(this);
    };
    Object.defineProperty(HTMLInputElement.prototype, "value", desc);
  }
}
