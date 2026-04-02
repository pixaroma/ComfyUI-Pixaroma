// ============================================================
// Pixaroma Base Editor — Master Shell  v1
// Template Method pattern: defines the UI skeleton and calls
// hook methods that subclasses override to inject their content.
// ============================================================
import { installFocusTrap } from "./pixaroma_shared.js";

const PXB_STYLE_ID = "pixaroma-base-shell-v1";

function injectBaseStyles() {
    if (document.getElementById(PXB_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = PXB_STYLE_ID;
    s.textContent = `
:root {
    --pxb-brand:          #f66744;
    --pxb-bg:             #171718;
    --pxb-bg-bar:         #131415;
    --pxb-bg-sidebar:     #181a1b;
    --pxb-border:         #2e3033;
    --pxb-border-inner:   #2a2c2e;
    --pxb-text:           #e0e0e0;
    --pxb-titlebar-h:     38px;
    --pxb-font:           'Segoe UI', system-ui, sans-serif;
    --pxb-font-mono:      'Consolas', 'Segoe UI', monospace;
}
.pxb-overlay {
    position: fixed; inset: 0; z-index: 11000;
    display: flex; flex-direction: column;
    background: var(--pxb-bg); font-family: var(--pxb-font);
    color: var(--pxb-text); overflow: hidden; user-select: none;
}
.pxb-titlebar {
    display: flex; align-items: center; gap: 8px;
    padding: 0 12px; background: var(--pxb-bg-bar);
    border-bottom: 1px solid var(--pxb-border);
    flex-shrink: 0; height: var(--pxb-titlebar-h); box-sizing: border-box;
}
.pxb-title {
    display: flex; align-items: center; gap: 7px;
    color: #fff; font-size: 13px; font-weight: bold; flex: 1;
}
.pxb-title img { width: 20px; height: 20px; flex-shrink: 0; }
.pxb-brand { color: var(--pxb-brand); }
.pxb-titlebar-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.pxb-topbar {
    display: flex; align-items: center; gap: 5px; flex-shrink: 0;
    padding: 4px 10px; background: var(--pxb-bg-sidebar);
    border-bottom: 1px solid var(--pxb-border-inner); min-height: 34px;
}
.pxb-body { display: flex; flex: 1; overflow: hidden; min-height: 0; }
.pxb-help-strip {
    padding: 3px 12px; background: var(--pxb-bg-bar);
    border-top: 1px solid var(--pxb-border-inner);
    font-size: 9px; color: #666; flex-shrink: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pxb-bottombar {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 12px; background: var(--pxb-bg-bar);
    border-top: 1px solid var(--pxb-border); flex-shrink: 0;
}
`;
    document.head.appendChild(s);
}

// ─── Base Class ───────────────────────────────────────────────
export class PixaromaEditorBase {
    constructor() {
        this.onSave  = null;
        this.onClose = null;
        this.el = {};
    }

    // ── Hook Methods — override in subclasses ─────────────────

    /** HTML string rendered after the logo in the titlebar. */
    _editorTitle() { return `Editor <span class="pxb-brand">Pixaroma</span>`; }

    /** Return an Element (or null) placed right-aligned in the titlebar. */
    _buildTitlebarActions() { return null; }

    /** Return an Element (or null) rendered between titlebar and body. */
    _buildTopBar() { return null; }

    /** Return the left sidebar Element (or null to omit). */
    _buildLeftSidebar() { return null; }

    /** Return the main workspace/canvas Element. */
    _buildWorkspace() { return document.createElement("div"); }

    /** Return the right sidebar Element (or null to omit). */
    _buildRightSidebar() { return null; }

    /** Return a narrow keyboard-hint strip Element (or null to omit). */
    _buildHelpStrip() { return null; }

    /** Return the status/footer bar Element (or null to omit). */
    _buildBottomBar() { return null; }

    /** Called after the UI is mounted in the DOM. Put init logic here. */
    _onOpen(jsonStr) {}

    // ── Shell Assembly ─────────────────────────────────────────

    _buildUI() {
        injectBaseStyles();

        const ov = document.createElement("div");
        ov.className = "pxb-overlay";
        this.el.overlay = ov;

        // ── Titlebar ──
        const tb = document.createElement("div"); tb.className = "pxb-titlebar";
        const titleEl = document.createElement("div"); titleEl.className = "pxb-title";
        titleEl.innerHTML =
            `<img src="/pixaroma/assets/pixaroma_logo.svg" alt="" aria-hidden="true">${this._editorTitle()}`;
        tb.appendChild(titleEl);
        const titleActions = this._buildTitlebarActions();
        if (titleActions) {
            const actWrap = document.createElement("div");
            actWrap.className = "pxb-titlebar-actions";
            actWrap.appendChild(titleActions);
            tb.appendChild(actWrap);
        }
        ov.appendChild(tb);

        // ── Optional TopBar ──
        const topBar = this._buildTopBar();
        if (topBar) { topBar.classList.add("pxb-topbar"); ov.appendChild(topBar); }

        // ── Body (left + workspace + right) ──
        const body = document.createElement("div"); body.className = "pxb-body";
        this.el.body = body;
        const left = this._buildLeftSidebar();   if (left)  body.appendChild(left);
        const ws   = this._buildWorkspace();     if (ws)    body.appendChild(ws);
        const right = this._buildRightSidebar(); if (right) body.appendChild(right);
        ov.appendChild(body);

        // ── Optional HelpStrip ──
        const helpStrip = this._buildHelpStrip();
        if (helpStrip) { helpStrip.classList.add("pxb-help-strip"); ov.appendChild(helpStrip); }

        // ── Optional BottomBar ──
        const bottomBar = this._buildBottomBar();
        if (bottomBar) { bottomBar.classList.add("pxb-bottombar"); ov.appendChild(bottomBar); }
    }

    // ── Lifecycle ──────────────────────────────────────────────

    open(jsonStr) {
        this._buildUI();
        document.body.appendChild(this.el.overlay);
        installFocusTrap(this.el.overlay);
        this._onOpen(jsonStr);
    }

    _close() {
        this.el.overlay?.remove();
        if (this.onClose) this.onClose();
    }
}

