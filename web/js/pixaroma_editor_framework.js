// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Editor Framework v1                                ║
// ║  Shared UI toolkit for all Pixaroma editors                  ║
// ╠═══════════════════════════════════════════════════════════════╣
// ║  Single source of truth for layout, components, and styling. ║
// ║  Change once here -> every editor (Crop, Paint, Composer,    ║
// ║  3D Builder) updates automatically.                          ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// ─── HOW TO USE ─────────────────────────────────────────────────
//   1. import { createEditorLayout, createButton, ... } from "./pixaroma_editor_framework.js";
//   2. Call createEditorLayout({ editorName, onSave, onClose, ... }) to get a full editor shell.
//   3. Populate the returned sidebars/workspace with component factory functions.
//   4. Call layout.mount() to display, layout.unmount() to tear down.
//
// ─── EXPORTED FUNCTIONS (Quick Reference) ───────────────────────
//
//   Layout:
//     createEditorLayout(config)        Main editor shell (overlay, titlebar, sidebars, workspace)
//
//   Component Factories:
//     createButton(text, opts)          Standard/accent/danger/sm/icon/full button
//     createPanel(title, opts)          Collapsible sidebar section
//     createSliderRow(label, min, max, value, onChange, opts)
//     createNumberInput(opts)           Styled number <input>
//     createSelectInput(opts)           Styled <select> dropdown
//     createColorInput(opts)            Styled color picker <input>
//     createRow(label, content, opts)   Label + content row
//     createButtonRow(buttons)          Horizontal button group
//     createPillGrid(options, columns, onChange, opts)  Toggle-pill grid
//     createToolButton(icon, label, onClick, opts)     Tool palette button
//     createToolGrid(columns, tools)    Grid of tool buttons
//     createCheckbox(label, checked, onChange)
//     createDivider()                   Horizontal separator line
//     createInfo(html)                  Info/help text block
//
//   Layer System:
//     createLayerItem(config)           Single layer row (visibility, thumb, name, lock)
//     createLayersList(config)          Scrollable layer list with drag reorder + action bar
//     createLayerPanel(config)          Full Photoshop-style panel (blend + opacity + layers)
//
//   Canvas Components:
//     createCanvasSettings(config)      Document size/ratio panel (ratio grid, W x H inputs)
//     createCanvasToolbar(config)       Add Image, BG Color, Clear/Reset buttons + drag-drop
//     createCanvasFrame(workspace)      Orange border + dimension label + gray masks
//
//   Transform:
//     createTransformPanel(config)      Fit/Flip/Rotate buttons + sliders
//
//   Zoom:
//     createZoomControls(onZoomIn, onZoomOut, onFit)
//
//   Constants:
//     BRAND                             "#f66744" — the accent color hex string
//
// ─── COLOR PALETTE REFERENCE ────────────────────────────────────
//   All colors are defined as CSS custom properties on .pxf-overlay.
//   To re-theme all editors, change these values in the CSS block below:
//
//   Variable               Hex        Purpose
//   --pxf-accent           #f66744    Brand orange — buttons, active states, highlights
//   --pxf-accent-hover     #e05535    Darker orange on hover
//   --pxf-bg-darkest       #131415    Titlebar background, input backgrounds
//   --pxf-bg-dark          #171718    Overlay (fullscreen) background
//   --pxf-bg-sidebar       #181a1b    Sidebar background
//   --pxf-bg-panel         #242628    Panel/card backgrounds
//   --pxf-bg-input         #111       Text input backgrounds
//   --pxf-bg-btn           #353535    Default button background
//   --pxf-border           #3a3d40    Primary border color
//   --pxf-border-subtle    #2a2c2e    Subtle/secondary border color
//   --pxf-border-titlebar  #2e3033    Titlebar bottom border
//   --pxf-text             #e0e0e0    Primary text color
//   --pxf-text-dim         #888       Secondary/label text
//   --pxf-text-dimmer      #666       Tertiary/muted text
//   --pxf-text-label       #999       Label text
//   --pxf-select-bg        #2a1800    Selected layer background (warm tint)
//   --pxf-select-border    #f66744    Selected layer border (accent)
//   --pxf-multi-bg         #0a1a2a    Multi-selected layer background (cool tint)
//   --pxf-multi-border     #0ea5e9    Multi-selected layer border (blue)
//   --pxf-danger           #d46060    Danger/destructive action color
//   --pxf-danger-bg        #2a1a1a    Danger button hover background
//   --pxf-font             'Segoe UI', system-ui, sans-serif
//   --pxf-font-mono        monospace
//
// ═════════════════════════════════════════════════════════════════

import { installFocusTrap, PIXAROMA_LOGO } from "./pixaroma_shared.js";


// ═════════════════════════════════════════════════════════════════
//  SECTION: Theme Tokens & Internal Helpers
// ═════════════════════════════════════════════════════════════════

/** Brand accent color hex — re-exported for editor-specific use. */
export const BRAND = "#f66744";

/** Base path for UI icon SVGs served by the Pixaroma backend. */
const UI_ICON = "/pixaroma/assets/icons/ui/";

/**
 * Creates an <img> element pointing to a UI icon SVG.
 * @param {string} name - Filename inside the UI icons folder (e.g. "save.svg")
 * @param {number} [size=14] - Width and height in px
 * @returns {HTMLImageElement}
 */
function _uiIcon(name, size = 14) {
  const img = document.createElement("img");
  img.src = "/pixaroma/assets/icons/ui/" + name;
  img.style.cssText = `width:${size}px;height:${size}px;pointer-events:none;`;
  img.draggable = false;
  return img;
}

/** ID used for the injected <style> element — prevents duplicate injection. */
const STYLE_ID = "pixaroma-framework-v1";


// ═════════════════════════════════════════════════════════════════
//  SECTION: CSS Injection
// ═════════════════════════════════════════════════════════════════
// All framework styles are injected once into <head> via a single
// <style> element. The styles use CSS custom properties defined on
// .pxf-overlay so that every editor inherits the same theme.

function injectFrameworkStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
/* ═══════════════════════════════════════════════════════
   Pixaroma Editor Framework — Shared Stylesheet
   ═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   COLOR PALETTE — Change these to re-theme all editors:
   --pxf-accent: #f66744        (brand orange - buttons, active states)
   --pxf-accent-hover: #e05535  (darker orange on hover)
   --pxf-bg-darkest: #131415    (titlebar, inputs)
   --pxf-bg-dark: #171718       (overlay background)
   --pxf-bg-sidebar: #181a1b    (sidebar background)
   --pxf-bg-panel: #242628      (panel/card backgrounds)
   --pxf-bg-input: #111         (text input backgrounds)
   --pxf-bg-btn: #353535        (default button background)
   --pxf-border: #3a3d40        (primary borders)
   --pxf-border-subtle: #2a2c2e (subtle borders)
   --pxf-border-titlebar: #2e3033 (titlebar bottom border)
   --pxf-text: #e0e0e0          (primary text)
   --pxf-text-dim: #888         (secondary text)
   --pxf-text-dimmer: #666      (muted text)
   --pxf-text-label: #999       (label text)
   --pxf-select-bg: #2a1800     (selected layer - warm)
   --pxf-select-border: #f66744 (selected layer border)
   --pxf-multi-bg: #0a1a2a      (multi-select - cool)
   --pxf-multi-border: #0ea5e9  (multi-select border)
   --pxf-danger: #d46060        (danger/destructive)
   --pxf-danger-bg: #2a1a1a     (danger background)
   --pxf-font: 'Segoe UI', system-ui, sans-serif
   --pxf-font-mono: monospace
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
  position: relative; z-index: 5;
}
.pxf-sidebar-left { border-right: 1px solid var(--pxf-border-subtle); }
.pxf-sidebar-right { border-left: 1px solid var(--pxf-border-subtle); }

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
/* Base: all buttons share this foundation */
.pxf-btn, .pxf-btn-full, .pxf-btn-sm {
  font-family: inherit; cursor: pointer;
  border-radius: 5px; border: 1px solid var(--pxf-border);
  transition: all .15s ease; white-space: nowrap;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
}
.pxf-btn:disabled, .pxf-btn-full:disabled, .pxf-btn-sm:disabled {
  opacity: 0.35; cursor: default; pointer-events: none;
}
/* SVG icon inside any button */
.pxf-btn img, .pxf-btn-full img, .pxf-btn-sm img {
  width: 14px; height: 14px; filter: brightness(0) invert(0.7);
  pointer-events: none;
}
.pxf-btn:hover img, .pxf-btn-full:hover img, .pxf-btn-sm:hover img {
  filter: brightness(0) invert(1);
}

/* Standard button (medium, inline) */
.pxf-btn {
  background: var(--pxf-bg-btn); color: #ccc;
  padding: 6px 14px; font-size: 12px;
}
.pxf-btn:hover { background: #2e3033; color: var(--pxf-accent); border-color: var(--pxf-accent); }

/* Accent button (orange, primary action) */
.pxf-btn.pxf-btn-accent, .pxf-btn-accent {
  background: var(--pxf-accent); border-color: var(--pxf-accent);
  color: #fff; font-weight: bold;
}
.pxf-btn.pxf-btn-accent:hover, .pxf-btn-accent:hover {
  background: var(--pxf-accent-hover); border-color: var(--pxf-accent-hover);
}
.pxf-btn-accent img { filter: brightness(0) invert(1); }

/* Danger button — red border, on hover fills red */
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

/* Full-width button (sidebar actions) */
.pxf-btn-full {
  width: 100%; padding: 7px 10px; font-size: 11px;
  background: #1e2022; color: #ccc;
}
.pxf-btn-full:hover { background: #2e3033; color: var(--pxf-accent); border-color: var(--pxf-accent); }

/* Small square button (layer actions, toolbar) */
.pxf-btn-sm {
  width: 28px; height: 28px; padding: 0; flex-shrink: 0;
  background: var(--pxf-bg-panel); color: #ccc; font-size: 13px;
}
.pxf-btn-sm:hover { background: #2e3033; color: var(--pxf-accent); border-color: var(--pxf-accent); }

/* Icon-only button (minimal, no border) */
.pxf-btn-icon {
  background: none; border: none; color: #ccc; padding: 4px;
  cursor: pointer; font-size: 16px; border-radius: 4px; transition: all .15s;
  display: inline-flex; align-items: center; justify-content: center;
}
.pxf-btn-icon:hover { color: var(--pxf-accent); background: rgba(255,255,255,0.05); }
.pxf-btn-icon:disabled { opacity: 0.3; cursor: default; pointer-events: none; }

/* Half-width buttons (two side by side in a row) */
.pxf-btn-row { display: flex; gap: 6px; }
.pxf-btn-row > .pxf-btn, .pxf-btn-row > .pxf-btn-full { flex: 1; }

/* Active state (toggle buttons) */
.pxf-btn.active { background: var(--pxf-accent); border-color: var(--pxf-accent); color: #fff; }
.pxf-btn.active img { filter: brightness(0) invert(1); }

/* ── Pill grid (toggle buttons like aspect ratios) ─── */
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

/* ── Unified slider styling (all range inputs inside framework) ──────
   The filled portion of the track is driven by the --pxf-fill CSS variable,
   which is updated by JS (both on user drag and programmatic .value sets).
   See the "Slider Fill System" section below for the patched .value setter. */
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
  display: flex; flex-direction: column; min-height: 0;
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
  overflow-y: auto; min-height: 40px; max-height: 250px;
  padding: 2px 0;
}
/* Resize handle for layer list */
.pxf-layers-resize {
  height: 6px; cursor: ns-resize;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.pxf-layers-resize::after {
  content: ""; display: block;
  width: 32px; height: 3px;
  background: var(--pxf-border); border-radius: 2px;
  transition: background .15s;
}
.pxf-layers-resize:hover::after { background: var(--pxf-accent); }
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

/* ── Help overlay (unified modal) ───────────────────── */
.pxf-help-overlay {
  display: none; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: #171718; border: 1px solid var(--pxf-accent);
  border-radius: 10px; padding: 0;
  width: 520px; max-width: 90%; max-height: 80vh;
  z-index: 100; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
  font-family: var(--pxf-font);
}
.pxf-help-header {
  display: flex; align-items: center; padding: 14px 18px;
  border-bottom: 1px solid #2a2a2a;
}
.pxf-help-header h3 { flex: 1; color: var(--pxf-accent); font-size: 14px; margin: 0; font-weight: 600; }
.pxf-help-content {
  padding: 16px 18px; overflow-y: auto; max-height: 55vh;
  font-size: 11px; line-height: 1.8; color: #ccc;
}
.pxf-help-content kbd {
  background: #2a2c2e; border: 1px solid #444; border-radius: 3px;
  padding: 1px 5px; font-size: 10px; color: var(--pxf-text);
}
.pxf-help-content b { color: #eee; }
.pxf-help-footer {
  padding: 12px 18px; border-top: 1px solid #2a2a2a;
  font-size: 10px; color: #666; text-align: center; line-height: 1.6;
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
  font-size: 9px; color: rgba(249, 115, 22, 0.6);
  font-family: var(--pxf-font-mono); white-space: nowrap;
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
  // Range inputs use a CSS linear-gradient background with a --pxf-fill
  // custom property to show the filled portion of the track. This works
  // great on user drag (via the "input" event), but programmatic changes
  // to input.value do NOT fire "input" events.
  //
  // Solution: We monkey-patch HTMLInputElement.prototype.value's setter
  // so that any .value = X assignment on a range input inside .pxf-overlay
  // also updates --pxf-fill. This is done ONCE globally (guarded by
  // window._pxfSliderFillInit) to avoid double-patching.
  if (!window._pxfSliderFillInit) {
    window._pxfSliderFillInit = true;
    window._pxfUpdateFill = function(input) {
      const mn = parseFloat(input.min) || 0, mx = parseFloat(input.max) || 100;
      const v = parseFloat(input.value) || 0;
      input.style.setProperty("--pxf-fill", Math.max(0, Math.min(100, ((v - mn) / (mx - mn)) * 100)) + "%");
    };
    // Update fill on user drag
    document.addEventListener("input", (e) => {
      if (e.target.type === "range" && e.target.closest(".pxf-overlay")) window._pxfUpdateFill(e.target);
    });
    // Patch .value setter so programmatic sets also update the fill
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const origSet = desc.set;
    desc.set = function(v) {
      origSet.call(this, v);
      if (this.type === "range" && this.closest(".pxf-overlay")) window._pxfUpdateFill(this);
    };
    Object.defineProperty(HTMLInputElement.prototype, "value", desc);
  }
}


// ═════════════════════════════════════════════════════════════════
//  SECTION: Layout Factory
// ═════════════════════════════════════════════════════════════════
// createEditorLayout() builds the entire editor shell:
//   Overlay > Titlebar > Body > [Left Sidebar | Workspace | Right Sidebar]
// Editors populate the sidebars and workspace with component factories.

/**
 * Creates the main editor layout — a fullscreen overlay with titlebar,
 * left/right sidebars, central workspace, and standard controls.
 *
 * @param {Object} config
 * @param {string}   config.editorName       - e.g. "Image Crop", "3D Builder"
 * @param {string}   [config.editorId]       - unique ID for overlay element
 * @param {number}   [config.leftWidth=260]  - left sidebar width (px)
 * @param {number}   [config.rightWidth=260] - right sidebar width (px), 0 = no right sidebar
 * @param {boolean}  [config.showUndoRedo=true]
 * @param {boolean}  [config.showZoomBar=false]
 * @param {boolean}  [config.showStatusBar=true]
 * @param {boolean}  [config.showTopOptionsBar=false]
 * @param {Function} [config.onSave]
 * @param {Function} [config.onClose]
 * @param {Function} [config.onUndo]
 * @param {Function} [config.onRedo]
 * @param {string}   [config.helpContent]    - HTML string for help panel
 * @returns {EditorLayout}
 */
export function createEditorLayout(config) {
  injectFrameworkStyles();

  const {
    editorName = "Editor",
    editorId,
    leftWidth = 260,
    rightWidth = 260,
    showUndoRedo = true,
    showZoomBar = true,
    showStatusBar = true,
    showTopOptionsBar = false,
    onSave,
    onClose,
    onUndo,
    onRedo,
    onZoomIn,
    onZoomOut,
    onZoomFit,
    helpContent = "",
  } = config;

  // ── Overlay ──
  const overlay = document.createElement("div");
  overlay.className = "pxf-overlay";
  if (editorId) overlay.id = editorId;

  // ── Titlebar ──
  const titlebar = document.createElement("div");
  titlebar.className = "pxf-titlebar";

  const title = document.createElement("span");
  title.className = "pxf-title";
  const logo = document.createElement("img");
  logo.className = "pxf-title-logo";
  logo.src = "/pixaroma/assets/pixaroma_logo.svg";
  title.appendChild(logo);
  title.append(` ${editorName} `);
  const brandSpan = document.createElement("span");
  brandSpan.className = "pxf-title-brand";
  brandSpan.textContent = "Pixaroma";
  title.appendChild(brandSpan);
  titlebar.appendChild(title);

  // Center slot (editors can add tools here, e.g. align bar)
  const titlebarCenter = document.createElement("div");
  titlebarCenter.className = "pxf-titlebar-center";
  titlebar.appendChild(titlebarCenter);

  // Right actions: zoom + undo/redo
  const actions = document.createElement("div");
  actions.className = "pxf-titlebar-actions";

  // Zoom controls in titlebar
  let zoomBarEl = null, zoomLabelEl = null;
  if (showZoomBar) {
    const zoomWrap = document.createElement("div");
    zoomWrap.className = "pxf-titlebar-zoom";
    const zoomOut = createButton("", { variant: "sm", title: "Zoom out", iconSrc: UI_ICON + "minus.svg", onClick: () => { if (onZoomOut) onZoomOut(); } });
    const zoomFit = createButton("⛶ Fit", { variant: "accent", title: "Fit to view", onClick: () => { if (onZoomFit) onZoomFit(); } });
    zoomLabelEl = document.createElement("span");
    zoomLabelEl.className = "pxf-zoom-label";
    zoomLabelEl.textContent = "100%";
    const zoomIn = createButton("", { variant: "sm", title: "Zoom in", iconSrc: UI_ICON + "plus.svg", onClick: () => { if (onZoomIn) onZoomIn(); } });
    zoomWrap.append(zoomOut, zoomFit, zoomLabelEl, zoomIn);
    actions.appendChild(zoomWrap);
    zoomBarEl = zoomWrap;

    // Separator between zoom and undo/redo
    const sep = document.createElement("div");
    sep.className = "pxf-titlebar-sep";
    sep.style.cssText = "margin-left: 35px; margin-right: 35px;";
    actions.appendChild(sep);
  }

  // Undo / Redo buttons
  let undoBtn = null, redoBtn = null;
  if (showUndoRedo) {
    undoBtn = createButton("Undo", { variant: "accent", iconSrc: UI_ICON + "rotate-ccw.svg", title: "Undo (Ctrl+Z)", onClick: onUndo });
    redoBtn = createButton("Redo", { variant: "accent", iconSrc: UI_ICON + "rotate-cw.svg", title: "Redo (Ctrl+Shift+Z)", onClick: onRedo });
    undoBtn.style.cssText = "padding:5px 14px;font-size:12px;";
    redoBtn.style.cssText = "padding:5px 14px;font-size:12px;";
    actions.append(undoBtn, redoBtn);
  }

  titlebar.appendChild(actions);
  overlay.appendChild(titlebar);

  // ── Top options bar ──
  let topOptionsBar = null;
  if (showTopOptionsBar) {
    topOptionsBar = document.createElement("div");
    topOptionsBar.className = "pxf-top-options";
    overlay.appendChild(topOptionsBar);
  }

  // ── Body ──
  const body = document.createElement("div");
  body.className = "pxf-body";

  // Left sidebar
  const leftSidebar = document.createElement("div");
  leftSidebar.className = "pxf-sidebar pxf-sidebar-left";
  leftSidebar.style.width = leftWidth + "px";
  body.appendChild(leftSidebar);

  // Workspace
  const workspace = document.createElement("div");
  workspace.className = "pxf-workspace";

  // Help overlay in workspace (unified modal with header/content/footer)
  const helpPanel = document.createElement("div");
  helpPanel.className = "pxf-help-overlay";
  if (helpContent) {
    helpPanel.innerHTML = `
      <div class="pxf-help-header">
        <h3>${editorName} — Shortcuts</h3>
        <button class="pxf-btn-sm" style="flex-shrink:0;">✕</button>
      </div>
      <div class="pxf-help-content">${helpContent}</div>
      <div class="pxf-help-footer">
        Designed by <a href="https://www.youtube.com/@pixaroma" target="_blank">Pixaroma</a>
        · <a href="https://github.com/pixaroma/ComfyUI-Pixaroma" target="_blank">GitHub</a><br>
        Collaborator: <a href="https://github.com/MohammadAboulEla" target="_blank">Makadi</a>
      </div>
    `;
    helpPanel.querySelector(".pxf-help-header button").addEventListener("click", () => {
      helpPanel.style.display = "none";
    });
  }
  workspace.appendChild(helpPanel);

  // Zoom bar reference (lives in titlebar, not workspace)
  let zoomBar = zoomBarEl, zoomLabel = null;

  body.appendChild(workspace);

  // Right sidebar — ALWAYS present for consistency
  // (Save/Close/Help always live here at the bottom)
  const rightSidebar = document.createElement("div");
  rightSidebar.className = "pxf-sidebar pxf-sidebar-right";
  rightSidebar.style.width = (rightWidth || 220) + "px";
  body.appendChild(rightSidebar);

  overlay.appendChild(body);

  // ── Tool info (floating tooltip in workspace, bottom-left) ──
  const statusText = document.createElement("div");
  statusText.className = "pxf-tool-info";
  workspace.appendChild(statusText);
  const statusBar = null; // kept for backward compat

  // ── Footer (Save / Close / Help) — always bottom of right sidebar ──
  const sidebarFooter = document.createElement("div");
  sidebarFooter.className = "pxf-sidebar-footer";

  const helpBtn = createButton("Help", {
    variant: "standard",
    iconSrc: UI_ICON + "help.svg",
    onClick: () => toggleHelp(),
  });
  helpBtn.style.width = "100%";

  const footerBtnRow = document.createElement("div");
  footerBtnRow.className = "pxf-btn-row";

  const saveBtn = createButton("Save", { variant: "accent", iconSrc: UI_ICON + "save.svg", onClick: onSave });
  saveBtn.style.flex = "1";
  const closeBtn = createButton("Close", { variant: "standard", iconSrc: UI_ICON + "close.svg", onClick: onClose });
  closeBtn.style.flex = "1";

  footerBtnRow.append(saveBtn, closeBtn);
  sidebarFooter.append(helpBtn, footerBtnRow);
  rightSidebar.appendChild(sidebarFooter);

  // ── Methods ──
  function toggleHelp() {
    helpPanel.style.display = helpPanel.style.display === "block" ? "none" : "block";
  }

  const layout = {
    overlay,
    titlebar,
    titlebarCenter,
    topOptionsBar,
    body,
    leftSidebar,
    workspace,
    rightSidebar,
    sidebarFooter,
    statusBar,
    statusText,
    helpPanel,
    undoBtn,
    redoBtn,
    saveBtn,
    closeBtn,
    zoomBar,
    zoomLabel,

    /** Append the overlay to the document body and install the focus trap. */
    mount() {
      document.body.appendChild(overlay);
      installFocusTrap(overlay);
      // Initialize fill on ALL range inputs after mount
      requestAnimationFrame(() => {
        overlay.querySelectorAll('input[type=range]').forEach(s => {
          if (window._pxfUpdateFill) window._pxfUpdateFill(s);
        });
      });
    },
    /** Remove the overlay from the DOM. Calls onCleanup first if registered. */
    unmount() {
      if (layout.onCleanup) layout.onCleanup();
      overlay.remove();
    },
    /** Editor cleanup callback — editors register this so unmount() cleans up keys/listeners. */
    onCleanup: null,
    /** Update the floating status text in the workspace.
     *  @param {string} text - message to display
     *  @param {"info"|"warn"|"error"} [type="info"] - style type
     */
    setStatus(text, type) {
      if (statusText) {
        statusText.textContent = text;
        statusText.classList.remove("warn", "error");
        if (type === "warn") statusText.classList.add("warn");
        else if (type === "error") statusText.classList.add("error");
      }
    },
    /** Enable/disable undo and redo buttons based on history state. */
    setUndoState({ canUndo, canRedo }) {
      if (undoBtn) undoBtn.disabled = !canUndo;
      if (redoBtn) redoBtn.disabled = !canRedo;
    },
    toggleHelp,
    /** Update the zoom percentage label in the titlebar. */
    setZoomLabel(text) {
      if (zoomLabelEl) zoomLabelEl.textContent = text;
    },
    /** Unified save flow: call setSaving() before async save begins. */
    setSaving() {
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = ""; saveBtn.appendChild(_uiIcon("save.svg")); saveBtn.appendChild(document.createTextNode("Saving...")); }
      layout.setStatus("Saving...");
    },
    /** Call after a successful save. Auto-closes editor after 500ms if autoClose=true. */
    setSaved(autoClose = true) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = ""; saveBtn.appendChild(_uiIcon("save.svg")); saveBtn.appendChild(document.createTextNode("Saved!")); }
      layout.setStatus("Saved!");
      if (autoClose) setTimeout(() => layout.unmount(), 500);
    },
    /** Call on save failure to restore the save button and show an error message. */
    setSaveError(msg) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = ""; saveBtn.appendChild(_uiIcon("save.svg")); saveBtn.appendChild(document.createTextNode("Save")); }
      layout.setStatus(msg || "Save failed", "error");
    },
  };

  return layout;
}


// ═════════════════════════════════════════════════════════════════
//  SECTION: Component Factories
// ═════════════════════════════════════════════════════════════════
// Reusable UI building blocks. Each factory returns a DOM element
// (or an object with .el and helper methods) that can be appended
// to any sidebar panel.

// ── Button ───────────────────────────────────────────────────
/**
 * Creates a styled button element.
 *
 * @param {string} text - Button label text (can be empty for icon-only)
 * @param {Object} [opts]
 * @param {string} [opts.variant] - "standard"|"accent"|"danger"|"sm"|"icon"|"full"
 * @param {string} [opts.title]   - Tooltip text
 * @param {string} [opts.iconSrc] - SVG icon URL (displayed before text)
 * @param {Function} [opts.onClick]
 * @returns {HTMLButtonElement}
 */
export function createButton(text, opts = {}) {
  const btn = document.createElement("button");
  const variantClass = {
    standard: "pxf-btn",
    accent: "pxf-btn pxf-btn-accent",
    danger: "pxf-btn pxf-btn-danger",
    sm: "pxf-btn-sm",
    icon: "pxf-btn-icon",
    full: "pxf-btn-full",
  }[opts.variant || "standard"] || "pxf-btn";

  btn.className = variantClass;
  // Add SVG icon if provided
  if (opts.iconSrc) {
    const img = document.createElement("img");
    img.src = opts.iconSrc;
    img.draggable = false;
    btn.appendChild(img);
  }
  if (text) btn.appendChild(document.createTextNode(text));
  if (opts.title) btn.title = opts.title;
  if (opts.onClick) btn.addEventListener("click", opts.onClick);
  return btn;
}

// ── Panel / Section ──────────────────────────────────────────
/**
 * Creates a collapsible sidebar panel/section with a title header.
 *
 * @param {string} title - Panel title text (displayed in uppercase)
 * @param {Object} [opts]
 * @param {boolean} [opts.collapsed=false] - Start collapsed
 * @param {boolean} [opts.collapsible=false] - Allow click-to-collapse
 * @returns {{ el: HTMLElement, content: HTMLElement, setCollapsed(b: boolean): void }}
 */
export function createPanel(title, opts = {}) {
  const el = document.createElement("div");
  el.className = "pxf-panel" + (opts.collapsed ? " collapsed" : "");

  const titleEl = document.createElement("div");
  titleEl.className = "pxf-panel-title" + (opts.collapsible ? " clickable" : "");

  if (opts.collapsible) {
    const arrow = document.createElement("span");
    arrow.className = "pxf-panel-title-arrow";
    arrow.textContent = "▼";
    titleEl.appendChild(arrow);
  }

  const titleText = document.createTextNode(title);
  titleEl.appendChild(titleText);
  el.appendChild(titleEl);

  const content = document.createElement("div");
  content.className = "pxf-panel-content";
  el.appendChild(content);

  if (opts.collapsible) {
    titleEl.addEventListener("click", () => {
      el.classList.toggle("collapsed");
    });
  }

  return {
    el,
    content,
    setCollapsed(b) { el.classList.toggle("collapsed", b); },
  };
}

// ── Slider Row ───────────────────────────────────────────────
/**
 * Creates a labeled slider with a synchronized number input.
 * The slider fill is kept in sync via the --pxf-fill CSS variable.
 *
 * @param {string} label - Label text shown to the left of the slider
 * @param {number} min
 * @param {number} max
 * @param {number} value - Initial value
 * @param {Function} onChange - Called with the numeric value on every change
 * @param {Object} [opts]
 * @param {number} [opts.step=1]
 * @param {string} [opts.labelWidth="16px"]
 * @returns {{ el: HTMLElement, slider: HTMLInputElement, numInput: HTMLInputElement, setValue(n: number): void, setRange(min: number, max: number): void }}
 */
export function createSliderRow(label, min, max, value, onChange, opts = {}) {
  const row = document.createElement("div");
  row.className = "pxf-slider-row";

  const lbl = document.createElement("label");
  lbl.className = "pxf-slider-label";
  lbl.textContent = label;
  if (opts.labelWidth) lbl.style.width = opts.labelWidth;
  row.appendChild(lbl);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = min; slider.max = max; slider.value = value;
  if (opts.step) slider.step = opts.step;

  const numInput = document.createElement("input");
  numInput.type = "number";
  numInput.min = min; numInput.max = max; numInput.value = value;
  if (opts.step) numInput.step = opts.step;

  // Keep the --pxf-fill CSS variable in sync for the filled track
  function _syncFill() {
    const mn = parseFloat(slider.min) || 0, mx = parseFloat(slider.max) || 100;
    const v = parseFloat(slider.value) || 0;
    slider.style.setProperty("--pxf-fill", ((v - mn) / (mx - mn)) * 100 + "%");
  }
  _syncFill();

  slider.addEventListener("input", () => {
    numInput.value = slider.value;
    _syncFill();
    if (onChange) onChange(parseFloat(slider.value));
  });
  numInput.addEventListener("input", () => {
    slider.value = numInput.value;
    _syncFill();
    if (onChange) onChange(parseFloat(numInput.value));
  });

  row.appendChild(slider);
  row.appendChild(numInput);

  return {
    el: row,
    slider,
    numInput,
    setValue(n) {
      slider.value = n;
      numInput.value = n;
      _syncFill();
    },
    setRange(newMin, newMax) {
      slider.min = newMin; slider.max = newMax;
      numInput.min = newMin; numInput.max = newMax;
      _syncFill();
    },
  };
}

// ── Number Input ─────────────────────────────────────────────
/**
 * Creates a styled number input element.
 *
 * @param {Object} [opts]
 * @param {number} [opts.value=0]
 * @param {number} [opts.min]
 * @param {number} [opts.max]
 * @param {number} [opts.step=1]
 * @param {string} [opts.width="55px"]
 * @param {Function} [opts.onChange]
 * @returns {HTMLInputElement}
 */
export function createNumberInput(opts = {}) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "pxf-input-num";
  if (opts.value != null) input.value = opts.value;
  if (opts.min != null) input.min = opts.min;
  if (opts.max != null) input.max = opts.max;
  if (opts.step != null) input.step = opts.step;
  if (opts.width) input.style.width = opts.width;
  if (opts.onChange) input.addEventListener("input", () => opts.onChange(parseFloat(input.value)));
  return input;
}

// ── Select Input ─────────────────────────────────────────────
/**
 * Creates a styled select dropdown element.
 *
 * @param {Object} opts
 * @param {Array<{value:string, label:string}>} opts.options
 * @param {string} [opts.value] - Initially selected value
 * @param {Function} [opts.onChange]
 * @returns {HTMLSelectElement}
 */
export function createSelectInput(opts = {}) {
  const select = document.createElement("select");
  select.className = "pxf-select";
  (opts.options || []).forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  });
  if (opts.value) select.value = opts.value;
  if (opts.onChange) select.addEventListener("change", () => opts.onChange(select.value));
  return select;
}

// ── Color Input ──────────────────────────────────────────────
/**
 * Creates a styled color picker input element.
 *
 * @param {Object} [opts]
 * @param {string} [opts.value="#ffffff"]
 * @param {Function} [opts.onChange] - Called with hex string on color change
 * @returns {HTMLInputElement}
 */
export function createColorInput(opts = {}) {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "pxf-color-input";
  input.value = opts.value || "#ffffff";
  if (opts.onChange) input.addEventListener("input", () => opts.onChange(input.value));
  return input;
}

// ── Row (label + content) ────────────────────────────────────
/**
 * Creates a horizontal row with a label and content element(s).
 *
 * @param {string} label - Row label text
 * @param {HTMLElement|HTMLElement[]} content - Single element or array of elements
 * @param {Object} [opts]
 * @param {string} [opts.labelWidth="56px"]
 * @returns {HTMLElement}
 */
export function createRow(label, content, opts = {}) {
  const row = document.createElement("div");
  row.className = "pxf-row";

  const lbl = document.createElement("span");
  lbl.className = "pxf-row-label";
  lbl.textContent = label;
  lbl.style.width = opts.labelWidth || "56px";
  row.appendChild(lbl);

  if (Array.isArray(content)) {
    content.forEach((c) => row.appendChild(c));
  } else {
    row.appendChild(content);
  }
  return row;
}

// ── Button Row ───────────────────────────────────────────────
/**
 * Creates a horizontal flex row of buttons.
 *
 * @param {HTMLElement[]} buttons - Array of button elements
 * @returns {HTMLElement}
 */
export function createButtonRow(buttons) {
  const row = document.createElement("div");
  row.className = "pxf-btn-row";
  buttons.forEach((b) => row.appendChild(b));
  return row;
}

// ── Pill Grid ────────────────────────────────────────────────
/**
 * Creates a grid of toggle-pill buttons (e.g. aspect ratio selectors).
 *
 * @param {Array<{label:string, value:any}>} options
 * @param {number} columns - Number of grid columns
 * @param {Function} onChange - Called with the selected value
 * @param {Object} [opts]
 * @param {any} [opts.activeValue] - Initially active value
 * @returns {{ el: HTMLElement, pills: HTMLElement[], setActive(value: any): void }}
 */
export function createPillGrid(options, columns, onChange, opts = {}) {
  const grid = document.createElement("div");
  grid.className = "pxf-pill-grid";
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

  const pills = [];
  let activeValue = opts.activeValue;

  options.forEach((opt) => {
    const pill = document.createElement("button");
    pill.className = "pxf-pill" + (opt.value === activeValue ? " active" : "");
    pill.textContent = opt.label;
    pill.addEventListener("click", () => {
      activeValue = opt.value;
      pills.forEach((p, i) => p.classList.toggle("active", options[i].value === activeValue));
      if (onChange) onChange(activeValue);
    });
    grid.appendChild(pill);
    pills.push(pill);
  });

  return {
    el: grid,
    pills,
    setActive(value) {
      activeValue = value;
      pills.forEach((p, i) => p.classList.toggle("active", options[i].value === activeValue));
    },
  };
}

// ── Tool Button ──────────────────────────────────────────────
/**
 * Creates a tool palette button with icon and label text.
 *
 * @param {string} icon - Emoji or text icon displayed above the label
 * @param {string} label - Short label displayed below the icon
 * @param {Function} onClick
 * @param {Object} [opts]
 * @param {boolean} [opts.active=false]
 * @param {string} [opts.title] - Tooltip text
 * @returns {{ el: HTMLButtonElement, setActive(b: boolean): void }}
 */
export function createToolButton(icon, label, onClick, opts = {}) {
  const btn = document.createElement("button");
  btn.className = "pxf-tool-btn" + (opts.active ? " active" : "");
  if (opts.title) btn.title = opts.title;

  const iconEl = document.createElement("span");
  iconEl.className = "pxf-tool-btn-icon";
  iconEl.textContent = icon;

  const labelEl = document.createElement("span");
  labelEl.className = "pxf-tool-btn-label";
  labelEl.textContent = label;

  btn.append(iconEl, labelEl);
  btn.addEventListener("click", onClick);

  return {
    el: btn,
    setActive(b) { btn.classList.toggle("active", b); },
  };
}

// ── Tool Grid ────────────────────────────────────────────────
/**
 * Creates a CSS grid of tool buttons with mutual-exclusive active state.
 *
 * @param {number} columns - Number of grid columns
 * @param {Array<{icon:string, label:string, id:string, onClick:Function, title?:string}>} tools
 * @returns {{ el: HTMLElement, setActive(id: string): void }}
 */
export function createToolGrid(columns, tools) {
  const grid = document.createElement("div");
  grid.className = "pxf-tool-grid";
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

  const buttons = {};
  tools.forEach((tool) => {
    const tb = createToolButton(tool.icon, tool.label, tool.onClick, { title: tool.title });
    buttons[tool.id] = tb;
    grid.appendChild(tb.el);
  });

  return {
    el: grid,
    setActive(id) {
      Object.entries(buttons).forEach(([key, tb]) => tb.setActive(key === id));
    },
  };
}


// ═════════════════════════════════════════════════════════════════
//  SECTION: Layer System
// ═════════════════════════════════════════════════════════════════
// Photoshop-style layer panel with blend mode, opacity, a scrollable
// drag-to-reorder list, and action buttons (add, duplicate, delete,
// move, merge, flatten).
// Icons are loaded from /pixaroma/assets/icons/layers/*.svg

/** Base path for layer icon SVGs. */
const LAYER_ICON_BASE = "/pixaroma/assets/icons/layers/";

/**
 * Creates an <img> element pointing to a layer icon SVG.
 * @param {string} name - Icon name without extension (e.g. "eye-visible")
 * @param {number} [size=12]
 * @returns {HTMLImageElement}
 */
function _layerIcon(name, size = 12) {
  const img = document.createElement("img");
  img.src = LAYER_ICON_BASE + name + ".svg";
  img.width = size; img.height = size;
  img.draggable = false;
  return img;
}

/**
 * Creates a small square action button for the layer action bar.
 * @param {string} iconName - Icon name (e.g. "add", "delete")
 * @param {string} title - Tooltip text
 * @param {Function} onClick
 * @param {string} [cls=""] - Additional CSS class (e.g. "danger")
 * @returns {HTMLButtonElement}
 */
function _layerActionBtn(iconName, title, onClick, cls = "") {
  const btn = document.createElement("button");
  btn.className = "pxf-layer-action-btn" + (cls ? " " + cls : "");
  btn.title = title;
  btn.appendChild(_layerIcon(iconName, 14));
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

// ── Layer Item ───────────────────────────────────────────────
/**
 * Creates a single layer item row with visibility toggle, thumbnail,
 * editable name, edit icon, and lock toggle.
 *
 * @param {Object} config
 * @param {string}   config.name            - Layer display name
 * @param {boolean}  [config.active=false]  - Highlight as selected
 * @param {boolean}  [config.multiSelected=false]
 * @param {boolean}  config.visible
 * @param {boolean}  config.locked
 * @param {HTMLElement} [config.thumbnail]  - Canvas/image element for preview
 * @param {Function} config.onClick         - Called with click event
 * @param {Function} config.onVisibilityToggle
 * @param {Function} config.onLockToggle
 * @param {Function} [config.onRename]      - If provided, enables rename on double-click/edit icon
 * @returns {{ el, setName, setActive, setMulti, setVisible, setLocked }}
 */
export function createLayerItem(config) {
  const el = document.createElement("div");
  el.className = "pxf-layer-item";
  if (config.active) el.classList.add("active");
  if (config.multiSelected) el.classList.add("multi-selected");
  el.draggable = true;

  // Visibility toggle (SVG icon)
  const vis = document.createElement("div");
  vis.className = "pxf-layer-icon";
  vis.title = "Toggle visibility";
  let _visible = config.visible;
  vis.appendChild(_layerIcon(_visible ? "eye-visible" : "eye-hidden"));
  vis.addEventListener("click", (e) => {
    e.stopPropagation();
    config.onVisibilityToggle();
  });

  // Thumbnail
  const thumbWrap = document.createElement("div");
  thumbWrap.className = "pxf-layer-thumb";
  if (config.thumbnail) thumbWrap.appendChild(config.thumbnail);

  // Name
  const nameEl = document.createElement("span");
  nameEl.className = "pxf-layer-name";
  nameEl.textContent = config.name;

  // ── Inline rename ──────────────────────────────────────────
  // Double-click on the name (or click the edit icon) replaces the
  // name span with a text input. The focus trap interaction is tricky:
  // the editor's focus trap uses requestAnimationFrame to steal focus
  // back to the overlay. We counter this with a 60ms setTimeout before
  // calling input.focus(), which lets the trap fire first, then we
  // reclaim focus for the rename input.
  function startRename() {
    const currentName = nameEl.textContent;
    const input = document.createElement("input");
    input.className = "pxf-layer-name-input";
    input.value = currentName;
    nameEl.style.display = "none";
    nameEl.parentNode.insertBefore(input, nameEl);
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      const newName = input.value.trim() || currentName;
      nameEl.textContent = newName;
      nameEl.style.display = "";
      input.remove();
      if (config.onRename) config.onRename(newName);
    };
    // Stop keydown from propagating to the editor (prevents hotkeys
    // like Delete/Space from triggering while typing a name)
    input.addEventListener("keydown", (ke) => {
      ke.stopPropagation(); ke.stopImmediatePropagation();
      if (ke.key === "Enter") { finish(); }
      if (ke.key === "Escape") { input.value = currentName; finish(); }
    });
    // Delay focus: wait for the focus trap's rAF to fire, then reclaim
    // focus for the rename input. The blur->finish has an extra 50ms
    // delay to avoid conflicts with the focus trap's timing.
    setTimeout(() => {
      input.focus();
      input.select();
      input.addEventListener("blur", () => setTimeout(finish, 50));
    }, 60);
  }
  if (config.onRename) {
    nameEl.addEventListener("dblclick", (e) => { e.stopPropagation(); startRename(); });
  }

  // Edit icon button (pencil — triggers rename)
  let editBtn = null;
  if (config.onRename) {
    editBtn = document.createElement("div");
    editBtn.className = "pxf-layer-icon";
    editBtn.title = "Rename layer";
    editBtn.appendChild(_layerIcon("edit"));
    editBtn.addEventListener("click", (e) => { e.stopPropagation(); startRename(); });
  }

  // Lock toggle (SVG icon)
  const lock = document.createElement("div");
  lock.className = "pxf-layer-icon";
  lock.title = "Toggle lock";
  let _locked = config.locked;
  lock.appendChild(_layerIcon(_locked ? "lock-locked" : "lock-unlocked"));
  lock.addEventListener("click", (e) => {
    e.stopPropagation();
    config.onLockToggle();
  });

  el.append(vis, thumbWrap, nameEl);
  if (editBtn) el.appendChild(editBtn);
  el.appendChild(lock);

  // Click to select
  el.addEventListener("click", (e) => config.onClick(e));

  return {
    el,
    setName(s) { nameEl.textContent = s; },
    setActive(b) { el.classList.toggle("active", b); },
    setMulti(b) { el.classList.toggle("multi-selected", b); },
    setVisible(b) { _visible = b; vis.innerHTML = ""; vis.appendChild(_layerIcon(b ? "eye-visible" : "eye-hidden")); },
    setLocked(b) { _locked = b; lock.innerHTML = ""; lock.appendChild(_layerIcon(b ? "lock-locked" : "lock-unlocked")); },
  };
}

// ── Layers List ──────────────────────────────────────────────
/**
 * Creates a scrollable layer list with drag-to-reorder support
 * and an action button bar (add, duplicate, delete, move, merge, flatten).
 *
 * @param {Object} config
 * @param {string}   [config.title="Layers"]
 * @param {Function} config.onAdd
 * @param {Function} config.onDuplicate
 * @param {Function} config.onDelete
 * @param {Function} [config.onMoveUp]
 * @param {Function} [config.onMoveDown]
 * @param {Function} config.onReorder - Called with (fromIndex, toIndex)
 * @returns {{ el: HTMLElement, list: HTMLElement, refresh(items: HTMLElement[]): void }}
 */
export function createLayersList(config) {
  const panel = createPanel(config.title || "Layers");

  // Scrollable list container
  const list = document.createElement("div");
  list.className = "pxf-layers-list";
  panel.content.appendChild(list);

  // ── Drag-to-reorder ──
  // Uses the native HTML5 drag-and-drop API. Visual indicators
  // (drag-over-top / drag-over-bottom classes) show where the
  // layer will be inserted on drop.
  let dragIdx = -1;
  list.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".pxf-layer-item");
    if (!item) return;
    dragIdx = [...list.children].indexOf(item);
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const item = e.target.closest(".pxf-layer-item");
    if (!item || item.classList.contains("dragging")) return;
    // Clear all indicators
    list.querySelectorAll(".pxf-layer-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
    const rect = item.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    item.classList.add(e.clientY < mid ? "drag-over-top" : "drag-over-bottom");
  });
  list.addEventListener("dragleave", (e) => {
    const item = e.target.closest(".pxf-layer-item");
    if (item) item.classList.remove("drag-over-top", "drag-over-bottom");
  });
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    list.querySelectorAll(".pxf-layer-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom", "dragging");
    });
    const item = e.target.closest(".pxf-layer-item");
    if (!item) return;
    let dropIdx = [...list.children].indexOf(item);
    const rect = item.getBoundingClientRect();
    if (e.clientY >= rect.top + rect.height / 2) dropIdx++;
    if (dragIdx >= 0 && dropIdx !== dragIdx && config.onReorder) {
      config.onReorder(dragIdx, dropIdx > dragIdx ? dropIdx - 1 : dropIdx);
    }
    dragIdx = -1;
  });
  list.addEventListener("dragend", () => {
    list.querySelectorAll(".pxf-layer-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom", "dragging");
    });
    dragIdx = -1;
  });

  // Action buttons (SVG icons)
  const actions = document.createElement("div");
  actions.className = "pxf-layers-actions";
  if (config.onAdd) actions.appendChild(_layerActionBtn(config.addIcon || "add", config.addTitle || "Add layer", config.onAdd));
  if (config.onDuplicate) actions.appendChild(_layerActionBtn("duplicate", "Duplicate layer", config.onDuplicate));
  if (config.onDelete) actions.appendChild(_layerActionBtn("delete", "Delete layer", config.onDelete, "danger"));
  if (config.onMoveUp) actions.appendChild(_layerActionBtn("move-up", "Move up", config.onMoveUp));
  if (config.onMoveDown) actions.appendChild(_layerActionBtn("move-down", "Move down", config.onMoveDown));
  if (config.onMerge) actions.appendChild(_layerActionBtn("merge-down", "Merge down", config.onMerge));
  if (config.onFlatten) actions.appendChild(_layerActionBtn("flatten", "Flatten all", config.onFlatten));
  panel.content.appendChild(actions);

  return {
    el: panel.el,
    list,
    refresh(items) {
      list.innerHTML = "";
      items.forEach((item) => list.appendChild(item));
    },
  };
}

// ── Layer Panel (Photoshop-style: blend + opacity + list + actions) ───
/**
 * Creates a complete Photoshop-style layer panel with:
 * - Blend mode dropdown
 * - Opacity slider
 * - Layer list (scrollable, drag-to-reorder)
 * - Resizable list height via drag handle
 * - Action buttons (add, dup, delete, move up/down, merge, flatten)
 *
 * @param {Object} config
 * @param {boolean}  [config.showBlendMode=true]
 * @param {boolean}  [config.showOpacity=true]
 * @param {Array<{value:string,label:string}>} [config.blendModes] - Blend mode options
 * @param {Function} [config.onBlendChange]   - Called with blend mode value
 * @param {Function} [config.onOpacityChange] - Called with 0-100
 * @param {Function} config.onAdd
 * @param {Function} config.onDuplicate
 * @param {Function} config.onDelete
 * @param {Function} [config.onMoveUp]
 * @param {Function} [config.onMoveDown]
 * @param {Function} [config.onMerge]
 * @param {Function} [config.onFlatten]
 * @param {Function} config.onReorder - Called with (fromIndex, toIndex)
 * @returns {{
 *   el: HTMLElement,
 *   list: HTMLElement,
 *   blendSelect: HTMLSelectElement|null,
 *   opacitySlider: HTMLInputElement|null,
 *   opacityNum: HTMLInputElement|null,
 *   refresh(items: HTMLElement[]): void,
 *   setBlend(value: string): void,
 *   setOpacity(value: number): void,
 * }}
 */
export function createLayerPanel(config) {
  const wrapper = document.createElement("div");
  wrapper.className = "pxf-layer-panel";

  let blendSelect = null, opacitySlider = null, opacityNum = null;

  // ── Blend Mode row ──
  if (config.showBlendMode !== false) {
    const blendRow = document.createElement("div");
    blendRow.className = "pxf-layer-blend-row";
    const defaultModes = [
      { value: "Normal", label: "Normal" },
      { value: "Multiply", label: "Multiply" },
      { value: "Screen", label: "Screen" },
      { value: "Overlay", label: "Overlay" },
      { value: "Darken", label: "Darken" },
      { value: "Lighten", label: "Lighten" },
      { value: "Color Dodge", label: "Color Dodge" },
      { value: "Color Burn", label: "Color Burn" },
      { value: "Hard Light", label: "Hard Light" },
      { value: "Soft Light", label: "Soft Light" },
      { value: "Difference", label: "Difference" },
      { value: "Exclusion", label: "Exclusion" },
      { value: "Hue", label: "Hue" },
      { value: "Saturation", label: "Saturation" },
      { value: "Color", label: "Color" },
      { value: "Luminosity", label: "Luminosity" },
    ];
    blendSelect = document.createElement("select");
    blendSelect.className = "pxf-layer-blend-select";
    (config.blendModes || defaultModes).forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.value; opt.textContent = m.label;
      blendSelect.appendChild(opt);
    });
    blendSelect.addEventListener("change", () => {
      if (config.onBlendChange) config.onBlendChange(blendSelect.value);
    });
    blendRow.appendChild(blendSelect);
    wrapper.appendChild(blendRow);
  }

  // ── Opacity row ──
  if (config.showOpacity !== false) {
    const opRow = document.createElement("div");
    opRow.className = "pxf-layer-opacity-row";
    const opLabel = document.createElement("span");
    opLabel.className = "pxf-layer-opacity-label";
    opLabel.textContent = "Opacity";
    opacitySlider = document.createElement("input");
    opacitySlider.type = "range"; opacitySlider.min = 0; opacitySlider.max = 100; opacitySlider.value = 100;
    opacityNum = document.createElement("input");
    opacityNum.type = "number"; opacityNum.min = 0; opacityNum.max = 100; opacityNum.value = 100;
    function _syncOpFill() {
      if (window._pxfUpdateFill) window._pxfUpdateFill(opacitySlider);
    }
    opacitySlider.addEventListener("input", () => {
      opacityNum.value = opacitySlider.value;
      _syncOpFill();
      if (config.onOpacityChange) config.onOpacityChange(+opacitySlider.value);
    });
    opacityNum.addEventListener("change", () => {
      opacitySlider.value = opacityNum.value;
      _syncOpFill();
      if (config.onOpacityChange) config.onOpacityChange(+opacityNum.value);
    });
    // Set initial fill (100% = full)
    opacitySlider.style.setProperty("--pxf-fill", "100%");
    opRow.append(opLabel, opacitySlider, opacityNum);
    wrapper.appendChild(opRow);
  }

  // ── Layer list (delegate to createLayersList) ──
  const layersList = createLayersList(config);
  const list = layersList.list;
  wrapper.appendChild(list);

  // Resize handle — drag to change layer list height
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "pxf-layers-resize";
  resizeHandle.title = "Drag to resize layer list";
  wrapper.appendChild(resizeHandle);

  let _resizing = false, _startY = 0, _startH = 0;
  resizeHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    _resizing = true;
    _startY = e.clientY;
    _startH = list.offsetHeight;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!_resizing) return;
    const dy = e.clientY - _startY;
    const newH = Math.max(40, _startH + dy);
    list.style.maxHeight = newH + "px";
  });
  window.addEventListener("mouseup", () => {
    if (_resizing) {
      _resizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });

  // Action buttons
  const actionsEl = layersList.el.querySelector(".pxf-layers-actions");
  if (actionsEl) wrapper.appendChild(actionsEl);

  return {
    el: wrapper,
    list: layersList.list,
    blendSelect,
    opacitySlider,
    opacityNum,
    refresh(items) { layersList.refresh(items); },
    setBlend(v) { if (blendSelect) blendSelect.value = v; },
    setOpacity(v) {
      if (opacitySlider) {
        opacitySlider.value = v;
        opacitySlider.style.setProperty("--pxf-fill", v + "%");
      }
      if (opacityNum) opacityNum.value = v;
    },
  };
}


// ═════════════════════════════════════════════════════════════════
//  SECTION: Transform Panel
// ═════════════════════════════════════════════════════════════════
// Unified Fit/Flip/Rotate buttons + sliders for rotation, scale,
// stretch, and opacity. Used by Composer, Paint, and any future
// image editors that need per-layer transforms.

/**
 * Creates a unified transform properties panel with SVG icon buttons
 * and optional sliders for rotation, scale, stretch, and opacity.
 *
 * @param {Object} config
 * @param {Function} [config.onFitWidth]
 * @param {Function} [config.onFitHeight]
 * @param {Function} [config.onFlipH]
 * @param {Function} [config.onFlipV]
 * @param {Function} [config.onRotateCCW]      - Rotate -90 degrees
 * @param {Function} [config.onRotateCW]       - Rotate +90 degrees
 * @param {Function} [config.onReset]          - Reset all transforms
 * @param {boolean}  [config.showRotateSlider=true]
 * @param {boolean}  [config.showScaleSlider=true]
 * @param {boolean}  [config.showStretchSliders=true]
 * @param {boolean}  [config.showOpacitySlider=true]
 * @param {Function} [config.onRotateChange]   - Called with degrees
 * @param {Function} [config.onScaleChange]    - Called with percent
 * @param {Function} [config.onStretchHChange] - Called with percent
 * @param {Function} [config.onStretchVChange] - Called with percent
 * @param {Function} [config.onOpacityChange]  - Called with percent
 * @returns {{ el, content, fitW, fitH, flipH, flipV, rotCCW, rotCW, resetBtn, rotateSlider?, rotateNum?, scaleSlider?, scaleNum?, stretchHSlider?, stretchHNum?, stretchVSlider?, stretchVNum?, opacitySlider?, opacityNum?, setRotate?, setScale?, setStretchH?, setStretchV?, setOpacity? }}
 */
export function createTransformPanel(config) {
  const _ui = "/pixaroma/assets/icons/ui/";
  const panel = createPanel("Transform Properties");

  // ── Button rows: Fit, Flip, Rotate ──
  const fitW = createButton("Fit Width", { variant: "standard", iconSrc: _ui + "fit-width.svg", onClick: config.onFitWidth, title: "Fit to canvas width" });
  const fitH = createButton("Fit Height", { variant: "standard", iconSrc: _ui + "fit-height.svg", onClick: config.onFitHeight, title: "Fit to canvas height" });
  fitW.style.flex = "1"; fitH.style.flex = "1";
  panel.content.appendChild(createButtonRow([fitW, fitH]));

  const flipH = createButton("Flip H", { variant: "standard", iconSrc: _ui + "flip-horizontal.svg", onClick: config.onFlipH, title: "Flip horizontally" });
  const flipV = createButton("Flip V", { variant: "standard", iconSrc: _ui + "flip-vertical.svg", onClick: config.onFlipV, title: "Flip vertically" });
  flipH.style.flex = "1"; flipV.style.flex = "1";
  const flipRow = createButtonRow([flipH, flipV]); flipRow.style.marginTop = "4px";
  panel.content.appendChild(flipRow);

  const rotCCW = createButton("-90°", { variant: "standard", iconSrc: _ui + "rotate-ccw.svg", onClick: config.onRotateCCW, title: "Rotate -90°" });
  const rotCW = createButton("+90°", { variant: "standard", iconSrc: _ui + "rotate-cw.svg", onClick: config.onRotateCW, title: "Rotate +90°" });
  rotCCW.style.flex = "1"; rotCW.style.flex = "1";
  const rotRow = createButtonRow([rotCCW, rotCW]); rotRow.style.marginTop = "4px";
  panel.content.appendChild(rotRow);

  // ── Reset Transform (danger style with inline SVG icon) ──
  // Uses _dangerIcon() which creates an inline SVG colored #999 that
  // turns white on hover (when the button background turns red via CSS).
  let resetBtn = null;
  if (config.onReset) {
    resetBtn = createButton("Reset Transform", {
      variant: "full",
      onClick: config.onReset,
      title: "Reset all transforms to default",
    });
    resetBtn.classList.add("pxf-btn-danger");
    resetBtn.insertBefore(_dangerIcon("M5.1,36.2h8c-.1,8,5.1,15,12.2,17.7,7.8,2.9,16.4.6,21.5-5.8,3.3-4.1,4.6-9.2,4-14.4-1-8.6-7.8-15.3-16.4-16.4v6.5c0,.6-.6,1.3-1.1,1.4-.5.2-1.5.2-1.9-.2l-12-10.2c-.6-.5-.8-1.1-.8-1.9,0-.7.4-1.3,1-1.8l11.6-9.9c.6-.5,1.4-.6,2.1-.3.5.2,1,.9,1,1.6v6.4c4.6.5,9,1.9,12.8,4.5,6.5,4.5,10.6,11.2,11.6,19,.3,2.7.4,5,0,7.6-.9,6.2-3.9,12-8.4,16.2-12.2,11.1-30.9,8.9-40.4-4.6-3.1-4.4-4.8-9.7-4.8-15.5ZM38.7,41.7v-9.2c0-1.1-.7-1.9-1.7-2.2h-10.1c-1,.2-1.7,1.1-1.7,2.1v9.3c0,1.2.9,2.1,2.1,2.1h9.1c1.2,0,2.3-1,2.3-2.2Z"), resetBtn.firstChild);
    resetBtn.style.marginTop = "6px";
    panel.content.appendChild(resetBtn);
  }

  // ── Sliders (with spacing after buttons) ──
  const sliderWrap = document.createElement("div");
  sliderWrap.style.marginTop = "8px";
  const sliders = {};

  if (config.showRotateSlider !== false) {
    const s = createSliderRow("Rotate", 0, 360, 0, config.onRotateChange, { step: 1 });
    sliderWrap.appendChild(s.el);
    sliders.rotateSlider = s.slider; sliders.rotateNum = s.numInput;
    sliders.setRotate = (v) => s.setValue(v);
  }
  if (config.showScaleSlider !== false) {
    const s = createSliderRow("Scale %", 5, 300, 100, config.onScaleChange, { step: 1 });
    sliderWrap.appendChild(s.el);
    sliders.scaleSlider = s.slider; sliders.scaleNum = s.numInput;
    sliders.setScale = (v) => s.setValue(v);
  }
  if (config.showStretchSliders !== false) {
    const sh = createSliderRow("Horiz %", 5, 300, 100, config.onStretchHChange, { step: 1 });
    const sv = createSliderRow("Vert %", 5, 300, 100, config.onStretchVChange, { step: 1 });
    sliderWrap.append(sh.el, sv.el);
    sliders.stretchHSlider = sh.slider; sliders.stretchHNum = sh.numInput;
    sliders.stretchVSlider = sv.slider; sliders.stretchVNum = sv.numInput;
    sliders.setStretchH = (v) => sh.setValue(v);
    sliders.setStretchV = (v) => sv.setValue(v);
  }
  if (config.showOpacitySlider !== false) {
    const s = createSliderRow("Opacity", 0, 100, 100, config.onOpacityChange, { step: 1 });
    sliderWrap.appendChild(s.el);
    sliders.opacitySlider = s.slider; sliders.opacityNum = s.numInput;
    sliders.setOpacity = (v) => s.setValue(v);
  }
  if (sliderWrap.children.length > 0) panel.content.appendChild(sliderWrap);

  return {
    el: panel.el,
    content: panel.content,
    fitW, fitH, flipH, flipV, rotCCW, rotCW, resetBtn,
    ...sliders,
  };
}


// ═════════════════════════════════════════════════════════════════
//  SECTION: Zoom Controls
// ═════════════════════════════════════════════════════════════════

/**
 * Creates a floating zoom control bar (typically placed at the bottom
 * of the workspace) with zoom in/out buttons, a fit button, and a
 * percentage label.
 *
 * @param {Function} onZoomIn
 * @param {Function} onZoomOut
 * @param {Function} onFit
 * @returns {{ el: HTMLElement, setZoomLabel(text: string): void }}
 */
export function createZoomControls(onZoomIn, onZoomOut, onFit) {
  const bar = document.createElement("div");
  bar.className = "pxf-zoom-bar";

  const label = document.createElement("span");
  label.className = "pxf-zoom-label";
  label.textContent = "100%";

  bar.appendChild(createButton("\u2212", { variant: "sm", title: "Zoom out", onClick: onZoomOut }));
  bar.appendChild(createButton("Fit", { variant: "sm", title: "Fit to view", onClick: onFit }));
  bar.appendChild(label);
  bar.appendChild(createButton("+", { variant: "sm", title: "Zoom in", onClick: onZoomIn }));

  return {
    el: bar,
    setZoomLabel(text) { label.textContent = text; },
  };
}


// ═════════════════════════════════════════════════════════════════
//  SECTION: Utility Components
// ═════════════════════════════════════════════════════════════════

// ── Checkbox ─────────────────────────────────────────────────
/**
 * Creates a labeled checkbox row.
 *
 * @param {string} label
 * @param {boolean} checked - Initial checked state
 * @param {Function} onChange - Called with boolean
 * @returns {{ el: HTMLElement, checkbox: HTMLInputElement }}
 */
export function createCheckbox(label, checked, onChange) {
  const row = document.createElement("label");
  row.className = "pxf-check-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  row.appendChild(cb);
  row.append(label);
  return { el: row, checkbox: cb };
}

// ── Divider ──────────────────────────────────────────────────
/**
 * Creates a horizontal divider line.
 * @returns {HTMLElement}
 */
export function createDivider() {
  const div = document.createElement("div");
  div.className = "pxf-divider";
  return div;
}

// ── Info block ───────────────────────────────────────────────
/**
 * Creates an info/help text block that renders HTML content.
 *
 * @param {string} [html=""] - HTML content to display
 * @returns {{ el: HTMLElement, setHTML(s: string): void }}
 */
export function createInfo(html = "") {
  const el = document.createElement("div");
  el.className = "pxf-info";
  el.innerHTML = html;
  return {
    el,
    setHTML(s) { el.innerHTML = s; },
  };
}


// ═════════════════════════════════════════════════════════════════
//  SECTION: Canvas Components
// ═════════════════════════════════════════════════════════════════
// Canvas Settings, Canvas Toolbar, and Canvas Frame are the three
// standard components for editors that manage a document canvas.
// Typically placed at the top of the left sidebar.


// ── Canvas Settings (document size/ratio) ────────────────────

/** Preset aspect ratios for the canvas settings panel. */
const CANVAS_RATIOS = [
  { label: "Free",  w: 0,  h: 0  },
  { label: "1:1",   w: 1,  h: 1  },
  { label: "4:3",   w: 4,  h: 3  },
  { label: "3:2",   w: 3,  h: 2  },
  { label: "16:9",  w: 16, h: 9  },
  { label: "4:5",   w: 4,  h: 5  },
  { label: "3:4",   w: 3,  h: 4  },
  { label: "2:3",   w: 2,  h: 3  },
  { label: "9:16",  w: 9,  h: 16 },
  { label: "5:4",   w: 5,  h: 4  },
];

/**
 * Creates a unified canvas/document size settings panel with an
 * aspect ratio grid, width/height number inputs, and a swap button.
 *
 * @param {Object} config
 * @param {number}   config.width          - Initial width
 * @param {number}   config.height         - Initial height
 * @param {number}   [config.ratioIndex=0] - Initial ratio (0 = Free)
 * @param {number}   [config.minSize=64]   - Minimum dimension
 * @param {number}   [config.maxSize=8192] - Maximum dimension
 * @param {Function} config.onChange       - Called with { width, height, ratioIndex }
 * @returns {{
 *   el: HTMLElement,
 *   getWidth(): number,
 *   getHeight(): number,
 *   getRatioIndex(): number,
 *   setSize(w: number, h: number): void,
 *   setRatio(index: number): void,
 *   swap(): void,
 * }}
 */
export function createCanvasSettings(config) {
  const {
    width: initW = 1024,
    height: initH = 1024,
    ratioIndex: initRatio = 0,
    minSize = 64,
    maxSize = 8192,
    onChange,
  } = config;

  let curW = initW, curH = initH, curRatio = initRatio;

  const panel = createPanel("Canvas Settings");
  const wrapper = document.createElement("div");
  wrapper.className = "pxf-canvas-settings";

  // ── Ratio buttons ──
  const ratioGrid = document.createElement("div");
  ratioGrid.className = "pxf-ratio-grid";
  const ratioBtns = [];

  CANVAS_RATIOS.forEach((r, i) => {
    const btn = document.createElement("button");
    btn.className = "pxf-ratio-btn" + (i === curRatio ? " active" : "");
    btn.textContent = r.label;
    btn.addEventListener("click", () => _setRatio(i));
    ratioGrid.appendChild(btn);
    ratioBtns.push(btn);
  });
  wrapper.appendChild(ratioGrid);

  // ── Width x Height row ──
  const sizeRow = document.createElement("div");
  sizeRow.className = "pxf-size-row";

  const wLabel = document.createElement("span");
  wLabel.className = "pxf-size-label";
  wLabel.textContent = "W";

  const wInput = document.createElement("input");
  wInput.type = "number";
  wInput.className = "pxf-size-input";
  wInput.value = curW;
  wInput.min = minSize;
  wInput.max = maxSize;

  const xSign = document.createElement("span");
  xSign.className = "pxf-size-x";
  xSign.textContent = "\u00d7";

  const hLabel = document.createElement("span");
  hLabel.className = "pxf-size-label";
  hLabel.textContent = "H";

  const hInput = document.createElement("input");
  hInput.type = "number";
  hInput.className = "pxf-size-input";
  hInput.value = curH;
  hInput.min = minSize;
  hInput.max = maxSize;

  sizeRow.append(wLabel, wInput, xSign, hLabel, hInput);
  wrapper.appendChild(sizeRow);

  // ── Swap button ──
  const swapBtn = createButton("Swap Width/Height", {
    variant: "full",
    iconSrc: UI_ICON + "swap.svg",
    onClick: () => _swap(),
    title: "Swap width and height",
  });
  wrapper.appendChild(swapBtn);

  panel.content.appendChild(wrapper);

  // ── Internal logic ──

  function _clamp(v) {
    return Math.max(minSize, Math.min(maxSize, Math.round(v) || minSize));
  }

  function _getActiveRatio() {
    const r = CANVAS_RATIOS[curRatio];
    if (!r || r.w === 0) return 0; // Free
    return r.w / r.h;
  }

  function _updateBtns() {
    ratioBtns.forEach((b, i) => b.classList.toggle("active", i === curRatio));
  }

  function _fire() {
    wInput.value = curW;
    hInput.value = curH;
    _updateBtns();
    if (onChange) onChange({ width: curW, height: curH, ratioIndex: curRatio });
  }

  function _setRatio(idx) {
    curRatio = idx;
    const ratio = _getActiveRatio();
    if (ratio > 0) {
      // Adjust height to match ratio, keeping width
      curH = _clamp(curW / ratio);
      // If height hit the limit, adjust width back
      if (Math.abs(curH / curW - 1 / ratio) > 0.01) {
        curW = _clamp(curH * ratio);
      }
    }
    _fire();
  }

  function _swap() {
    const tmp = curW;
    curW = curH;
    curH = tmp;
    // Find the inverse ratio if one exists
    const r = CANVAS_RATIOS[curRatio];
    if (r && r.w > 0) {
      const invIdx = CANVAS_RATIOS.findIndex(p => p.w === r.h && p.h === r.w);
      if (invIdx >= 0) curRatio = invIdx;
    }
    _fire();
  }

  // Width input change
  wInput.addEventListener("change", () => {
    curW = _clamp(parseInt(wInput.value));
    const ratio = _getActiveRatio();
    if (ratio > 0) {
      curH = _clamp(curW / ratio);
    }
    _fire();
  });

  // Height input change
  hInput.addEventListener("change", () => {
    curH = _clamp(parseInt(hInput.value));
    const ratio = _getActiveRatio();
    if (ratio > 0) {
      curW = _clamp(curH * ratio);
    }
    _fire();
  });

  return {
    el: panel.el,
    getWidth() { return curW; },
    getHeight() { return curH; },
    getRatioIndex() { return curRatio; },
    setSize(w, h) {
      curW = _clamp(w);
      curH = _clamp(h);
      wInput.value = curW;
      hInput.value = curH;
    },
    setRatio(index) { _setRatio(index); },
    swap() { _swap(); },
  };
}


// ── Canvas Frame ─────────────────────────────────────────────

/**
 * Creates a canvas frame overlay in the workspace that shows:
 * - An orange border around the document area
 * - Gray semi-transparent masks outside the document bounds
 * - A dimension label (e.g. "1024x1024") at bottom-right of the frame
 *
 * Automatically repositions on workspace resize via ResizeObserver.
 *
 * @param {HTMLElement} workspace - The .pxf-workspace element
 * @returns {{
 *   update(docW: number, docH: number): void,
 *   getRect(): { left: number, top: number, width: number, height: number, scale: number },
 *   setVisible(v: boolean): void,
 *   remove(): void,
 * }}
 */
export function createCanvasFrame(workspace) {
  // 4 mask divs (top, bottom, left, right) to darken areas outside the document
  const masks = [];
  for (let i = 0; i < 4; i++) {
    const m = document.createElement("div");
    m.className = "pxf-canvas-mask";
    workspace.appendChild(m);
    masks.push(m);
  }

  // Orange frame border
  const frame = document.createElement("div");
  frame.className = "pxf-canvas-frame";
  workspace.appendChild(frame);

  // Dimension label
  const label = document.createElement("div");
  label.className = "pxf-canvas-frame-label";
  frame.appendChild(label);

  // Track last computed rect for getRect()
  let lastRect = { left: 0, top: 0, width: 0, height: 0, scale: 1 };

  // Auto-update on workspace resize
  let lastDocW = 0, lastDocH = 0;
  const ro = new ResizeObserver(() => {
    if (lastDocW > 0 && lastDocH > 0) update(lastDocW, lastDocH);
  });
  ro.observe(workspace);

  function update(docW, docH) {
    lastDocW = docW;
    lastDocH = docH;
    const vpW = workspace.clientWidth, vpH = workspace.clientHeight;
    if (!vpW || !vpH || !docW || !docH) return;

    // Fit document into workspace with padding
    const pad = 40;
    const availW = vpW - pad * 2, availH = vpH - pad * 2;
    const s = Math.min(availW / docW, availH / docH, 1);
    const fw = docW * s, fh = docH * s;
    const fl = (vpW - fw) / 2, ft = (vpH - fh) / 2;

    lastRect = { left: fl, top: ft, width: fw, height: fh, scale: s };

    // Position frame
    Object.assign(frame.style, {
      left: fl + "px", top: ft + "px",
      width: fw + "px", height: fh + "px",
    });
    label.textContent = `${docW}\u00d7${docH}`;

    // Position masks (top, bottom, left, right)
    const [mT, mB, mL, mR] = masks;
    Object.assign(mT.style, { left: "0", top: "0", width: vpW + "px", height: ft + "px" });
    Object.assign(mB.style, { left: "0", top: (ft + fh) + "px", width: vpW + "px", height: (vpH - ft - fh) + "px" });
    Object.assign(mL.style, { left: "0", top: ft + "px", width: fl + "px", height: fh + "px" });
    Object.assign(mR.style, { left: (fl + fw) + "px", top: ft + "px", width: (vpW - fl - fw) + "px", height: fh + "px" });
  }

  function remove() {
    ro.disconnect();
    frame.remove();
    masks.forEach(m => m.remove());
  }

  function setVisible(v) {
    const d = v ? "" : "none";
    frame.style.display = d;
    masks.forEach(m => m.style.display = d);
  }

  return {
    update,
    getRect() { return lastRect; },
    setVisible,
    remove,
  };
}


// ── Canvas Toolbar ───────────────────────────────────────────

/**
 * Creates a toolbar with Add Image, BG Color picker, Clear Canvas,
 * and Reset to Default buttons. Also provides a setupDropZone()
 * method to enable drag-and-drop image loading on the workspace.
 *
 * @param {Object} config
 * @param {Function}  config.onAddImage        - Called with File object
 * @param {Function}  [config.onBgColorChange] - Called with hex string
 * @param {Function}  [config.onClear]         - Called on clear
 * @param {Function}  [config.onReset]         - Called on reset
 * @param {string}    [config.bgColor="#ffffff"]
 * @param {boolean}   [config.showBgColor=true]
 * @param {boolean}   [config.showClear=true]
 * @param {boolean}   [config.showReset=true]
 * @param {string}    [config.addImageLabel="Add Image"]
 * @param {string}    [config.clearLabel="Clear Canvas"]
 * @param {string}    [config.resetLabel="Reset to Default"]
 * @returns {{ el: HTMLElement, fileInput: HTMLInputElement, setBgColor(hex: string): void, getBgColor(): string, setupDropZone(workspace: HTMLElement): void }}
 */

// Helper: creates a full-width button with an SVG icon + label
function _makeIconButton(iconSrc, label, onClick, title = "") {
  const btn = document.createElement("button");
  btn.className = "pxf-btn-full";
  btn.title = title || label;
  btn.style.cssText = "display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;padding:6px 8px;";
  const img = document.createElement("img");
  img.src = iconSrc;
  img.style.cssText = "width:14px;height:14px;filter:brightness(0) invert(0.7);";
  btn.appendChild(img);
  btn.appendChild(document.createTextNode(label));
  btn.addEventListener("click", onClick);
  btn.addEventListener("mouseenter", () => { img.style.filter = "brightness(0) invert(1)"; });
  btn.addEventListener("mouseleave", () => { img.style.filter = "brightness(0) invert(0.7)"; });
  return btn;
}

// ── Danger Icon (inline SVG) ─────────────────────────────────
// Creates an inline SVG icon for danger/destructive action buttons.
// The icon starts gray (#999) and turns white on hover when the
// button background fills with red (via CSS .pxf-btn-danger:hover).
// Using inline SVG instead of an <img> allows dynamic fill color
// changes without needing separate icon files for each state.
function _dangerIcon(pathD) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.style.cssText = "width:14px;height:14px;flex-shrink:0;transition:fill .15s;";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "#999");
  svg.appendChild(path);
  // On hover: icon turns white (button bg turns red via CSS)
  requestAnimationFrame(() => {
    const btn = svg.closest("button");
    if (btn) {
      btn.addEventListener("mouseenter", () => path.setAttribute("fill", "#ffffff"));
      btn.addEventListener("mouseleave", () => path.setAttribute("fill", "#999"));
    }
  });
  return svg;
}

export function createCanvasToolbar(config) {
  const {
    onAddImage,
    onBgColorChange,
    onClear,
    onReset,
    bgColor = "#ffffff",
    showBgColor = true,
    showClear = true,
    showReset = true,
    addImageLabel = "Add Image",
    clearLabel = "Clear Canvas",
    resetLabel = "Reset to Default",
  } = config;

  const wrapper = document.createElement("div");
  wrapper.className = "pxf-canvas-toolbar";

  // Hidden file input (triggered by the Add Image button)
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file && onAddImage) onAddImage(file);
    fileInput.value = "";
  });
  wrapper.appendChild(fileInput);

  // Add Image button
  const addBtn = createButton(addImageLabel, {
    variant: "full",
    iconSrc: UI_ICON + "upload.svg",
    onClick: () => fileInput.click(),
    title: "Browse for an image file",
  });
  wrapper.appendChild(addBtn);

  // BG Color row
  let colorInput = null;
  let _bgColor = bgColor;
  if (showBgColor) {
    const row = document.createElement("div");
    row.className = "pxf-canvas-toolbar-row";
    const label = document.createElement("span");
    label.style.cssText = "font-size:10px;color:#888;flex-shrink:0;";
    label.textContent = "BG:";
    colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = bgColor;
    colorInput.className = "pxf-color-input";
    colorInput.style.cssText = "flex:1;height:28px;";
    colorInput.addEventListener("input", () => {
      _bgColor = colorInput.value;
      if (onBgColorChange) onBgColorChange(colorInput.value);
    });
    row.append(label, colorInput);
    wrapper.appendChild(row);
  }

  // Clear Canvas button (danger style with inline colored SVG trash icon)
  if (showClear && onClear) {
    const clearBtn = createButton(clearLabel, {
      variant: "full",
      onClick: onClear,
      title: "Clear all content",
    });
    clearBtn.classList.add("pxf-btn-danger");
    clearBtn.insertBefore(_dangerIcon("M11.4,21.4h41.2l-5.1,38.2c-.3,1.9-1.9,3.3-3.9,3.3h-23.2c-1.9,0-3.6-1.4-3.9-3.3l-5.1-38.2ZM50.1,6.9h-13v-2.9c0-1.2-1-2.1-2.1-2.1h-6c-1.2,0-2.1,1-2.1,2.1v2.9h-13c-3.9.2-7,3.5-7,7.4v3h50.3v-3c0-3.9-3.1-7.2-7-7.4Z"), clearBtn.firstChild);
    wrapper.appendChild(clearBtn);
  }

  // Reset to Default button (danger style with inline colored SVG reset icon)
  if (showReset && onReset) {
    const resetBtn = createButton(resetLabel, {
      variant: "full",
      onClick: onReset,
      title: "Reset all settings to default",
    });
    resetBtn.classList.add("pxf-btn-danger");
    resetBtn.insertBefore(_dangerIcon("M5.1,36.2h8c-.1,8,5.1,15,12.2,17.7,7.8,2.9,16.4.6,21.5-5.8,3.3-4.1,4.6-9.2,4-14.4-1-8.6-7.8-15.3-16.4-16.4v6.5c0,.6-.6,1.3-1.1,1.4-.5.2-1.5.2-1.9-.2l-12-10.2c-.6-.5-.8-1.1-.8-1.9,0-.7.4-1.3,1-1.8l11.6-9.9c.6-.5,1.4-.6,2.1-.3.5.2,1,.9,1,1.6v6.4c4.6.5,9,1.9,12.8,4.5,6.5,4.5,10.6,11.2,11.6,19,.3,2.7.4,5,0,7.6-.9,6.2-3.9,12-8.4,16.2-12.2,11.1-30.9,8.9-40.4-4.6-3.1-4.4-4.8-9.7-4.8-15.5ZM38.7,41.7v-9.2c0-1.1-.7-1.9-1.7-2.2h-10.1c-1,.2-1.7,1.1-1.7,2.1v9.3c0,1.2.9,2.1,2.1,2.1h9.1c1.2,0,2.3-1,2.3-2.2Z"), resetBtn.firstChild);
    wrapper.appendChild(resetBtn);
  }

  // ── Drag & drop setup ──
  // Call setupDropZone(workspace) after the workspace element is available.
  // Creates an overlay with a dashed border that appears when dragging
  // image files over the workspace area.
  function setupDropZone(workspace) {
    if (!workspace || !onAddImage) return;

    const overlay = document.createElement("div");
    overlay.className = "pxf-drop-overlay";
    overlay.innerHTML = '<span class="pxf-drop-label">Drop image here</span>';
    workspace.appendChild(overlay);

    // Drag & drop on workspace — stopPropagation prevents ComfyUI from seeing events
    let dragCounter = 0;
    workspace.addEventListener("dragenter", (e) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter++;
      if (e.dataTransfer?.types?.includes("Files")) overlay.classList.add("active");
    });
    workspace.addEventListener("dragleave", (e) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove("active"); }
    });
    workspace.addEventListener("dragover", (e) => {
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    });
    workspace.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter = 0;
      overlay.classList.remove("active");
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("image/")) onAddImage(file);
    });

    // Also block drag events on sidebars/titlebar so ComfyUI doesn't see them
    const overlayEl = workspace.closest(".pxf-overlay");
    if (overlayEl) {
      ["dragenter","dragover","dragleave","drop"].forEach(evt => {
        overlayEl.addEventListener(evt, (e) => {
          e.preventDefault(); e.stopPropagation();
        });
      });
    }

    // Ctrl+V paste image from clipboard (window-level with capture to catch it everywhere)
    const _pasteHandler = (e) => {
      if (!overlayEl?.isConnected) { window.removeEventListener("paste", _pasteHandler, true); return; }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault(); e.stopPropagation();
          const file = item.getAsFile();
          if (file) onAddImage(file);
          break;
        }
      }
    };
    window.addEventListener("paste", _pasteHandler, true);
  }

  return {
    el: wrapper,
    fileInput,
    setBgColor(hex) {
      _bgColor = hex;
      if (colorInput) colorInput.value = hex;
    },
    getBgColor() { return _bgColor; },
    setupDropZone,
  };
}
