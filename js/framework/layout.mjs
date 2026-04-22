// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Editor Framework — Layout Factory                  ║
// ║  Creates the main editor shell (overlay, titlebar, sidebars) ║
// ╚═══════════════════════════════════════════════════════════════╝

import { installFocusTrap } from "../shared/utils.mjs";
import { injectFrameworkStyles, _uiIcon, UI_ICON } from "./theme.mjs";
import { createButton } from "./components.mjs";

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
  let zoomBarEl = null,
    zoomLabelEl = null;
  if (showZoomBar) {
    const zoomWrap = document.createElement("div");
    zoomWrap.className = "pxf-titlebar-zoom";
    const zoomOut = createButton("", {
      variant: "sm",
      title: "Zoom out",
      iconSrc: UI_ICON + "minus.svg",
      onClick: () => {
        if (onZoomOut) onZoomOut();
      },
    });
    const zoomFit = createButton("Fit", {
      variant: "accent",
      title: "Fit to view",
      onClick: () => {
        if (onZoomFit) onZoomFit();
      },
    });
    zoomLabelEl = document.createElement("span");
    zoomLabelEl.className = "pxf-zoom-label";
    zoomLabelEl.textContent = "100%";
    const zoomIn = createButton("", {
      variant: "sm",
      title: "Zoom in",
      iconSrc: UI_ICON + "plus.svg",
      onClick: () => {
        if (onZoomIn) onZoomIn();
      },
    });
    zoomWrap.append(zoomOut, zoomFit, zoomLabelEl, zoomIn);
    actions.appendChild(zoomWrap);
    zoomBarEl = zoomWrap;

    // Separator between zoom and undo/redo
    const sep = document.createElement("div");
    sep.className = "pxf-titlebar-sep";
    sep.style.cssText = "margin-left: 15px; margin-right: 15px;";
    actions.appendChild(sep);
  }

  // Undo / Redo buttons
  let undoBtn = null,
    redoBtn = null;
  if (showUndoRedo) {
    undoBtn = createButton("Undo", {
      variant: "accent",
      iconSrc: UI_ICON + "rotate-ccw.svg",
      title: "Undo (Ctrl+Z)",
      onClick: onUndo,
    });
    redoBtn = createButton("Redo", {
      variant: "accent",
      iconSrc: UI_ICON + "rotate-cw.svg",
      title: "Redo (Ctrl+Shift+Z)",
      onClick: onRedo,
    });
    undoBtn.style.cssText = "padding:5px 14px;font-size:12px;";
    redoBtn.style.cssText = "padding:5px 14px;font-size:12px;";
    actions.append(undoBtn, redoBtn);
  }

  // Header close button (close without saving)
  const headerCloseBtn = createButton(`✕ Close ${editorName}`, {
    variant: "danger",
    title: `Close ${editorName} (does not close ComfyUI)`,
    onClick: () => {
      if (onClose) onClose();
    },
  });
  headerCloseBtn.style.cssText = "padding:5px 12px;font-size:12px;font-weight:bold;margin-left:8px;";
  actions.appendChild(headerCloseBtn);

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

  // Help overlay in workspace
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
      </div>
    `;
    helpPanel
      .querySelector(".pxf-help-header button")
      .addEventListener("click", () => {
        helpPanel.style.display = "none";
      });
  }
  workspace.appendChild(helpPanel);

  // Zoom bar reference (lives in titlebar, not workspace)
  let zoomBar = zoomBarEl,
    zoomLabel = null;

  body.appendChild(workspace);

  // Right sidebar
  const rightSidebar = document.createElement("div");
  rightSidebar.className = "pxf-sidebar pxf-sidebar-right";
  rightSidebar.style.width = (rightWidth || 220) + "px";
  body.appendChild(rightSidebar);

  overlay.appendChild(body);

  // ── Tool info (floating tooltip in workspace, bottom-left) ──
  const statusText = document.createElement("div");
  statusText.className = "pxf-tool-info";
  workspace.appendChild(statusText);
  const statusBar = null;

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

  const saveBtn = createButton("Save", {
    variant: "accent",
    iconSrc: UI_ICON + "save.svg",
    onClick: onSave,
  });
  saveBtn.style.flex = "1";
  const closeBtn = createButton("Save to Disk", {
    variant: "standard",
    iconSrc: UI_ICON + "download.svg",
    title: "Save image to disk",
    onClick: () => {
      if (layout.onSaveToDisk) layout.onSaveToDisk();
    },
  });
  closeBtn.style.flex = "1";

  footerBtnRow.append(saveBtn, closeBtn);
  sidebarFooter.append(helpBtn, footerBtnRow);
  rightSidebar.appendChild(sidebarFooter);

  // ── Methods ──
  function toggleHelp() {
    helpPanel.style.display =
      helpPanel.style.display === "block" ? "none" : "block";
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

    mount() {
      document.body.appendChild(overlay);
      installFocusTrap(overlay);
      // Block ALL keyboard events from reaching ComfyUI while editor is open
      layout._kbBlock = (e) => {
        e.stopPropagation();
      };
      window.addEventListener("keydown", layout._kbBlock, { capture: true });
      window.addEventListener("keyup", layout._kbBlock, { capture: true });
      window.addEventListener("keypress", layout._kbBlock, { capture: true });
      requestAnimationFrame(() => {
        overlay.querySelectorAll("input[type=range]").forEach((s) => {
          if (window._pxfUpdateFill) window._pxfUpdateFill(s);
        });
      });
    },
    unmount() {
      if (layout._kbBlock) {
        window.removeEventListener("keydown", layout._kbBlock, {
          capture: true,
        });
        window.removeEventListener("keyup", layout._kbBlock, { capture: true });
        window.removeEventListener("keypress", layout._kbBlock, {
          capture: true,
        });
      }
      if (layout.onCleanup) layout.onCleanup();
      overlay.remove();
    },
    onCleanup: null,
    onSaveToDisk: null,
    setStatus(text, type) {
      if (statusText) {
        statusText.textContent = text;
        statusText.classList.remove("warn", "error");
        if (type === "warn") statusText.classList.add("warn");
        else if (type === "error") statusText.classList.add("error");
      }
    },
    setUndoState({ canUndo, canRedo }) {
      if (undoBtn) undoBtn.disabled = !canUndo;
      if (redoBtn) redoBtn.disabled = !canRedo;
    },
    toggleHelp,
    setZoomLabel(text) {
      if (zoomLabelEl) zoomLabelEl.textContent = text;
    },
    setSaving() {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "";
        saveBtn.appendChild(_uiIcon("save.svg"));
        saveBtn.appendChild(document.createTextNode("Saving..."));
      }
      layout.setStatus("Saving...");
    },
    setSaved(autoClose = true) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "";
        saveBtn.appendChild(_uiIcon("save.svg"));
        saveBtn.appendChild(document.createTextNode("Saved!"));
      }
      layout.setStatus("Saved!");
      if (autoClose) setTimeout(() => layout.unmount(), 500);
    },
    setSaveError(msg) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "";
        saveBtn.appendChild(_uiIcon("save.svg"));
        saveBtn.appendChild(document.createTextNode("Save"));
      }
      layout.setStatus(msg || "Save failed", "error");
    },
  };

  return layout;
}
