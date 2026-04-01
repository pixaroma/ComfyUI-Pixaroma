// ============================================================
// Pixaroma — Shared node utilities
// ============================================================

import { app } from "/scripts/app.js";

const BRAND = "#f66744";
const LOGO_URL = "/pixaroma/assets/pixaroma_logo.svg";
const BASE_WIDTH = 380;

// ─── Block ALL ComfyUI shortcuts while any Pixaroma editor is open ──
// ComfyUI registers its keyboard handlers on window with capture:true
// BEFORE extensions load, so stopImmediatePropagation() from our
// handlers cannot prevent them. We use three layers of protection:
//
// 1) Monkey-patch app.loadGraphData — blocks undo/redo from restoring
//    previous graph states while an editor overlay is open.
//
// 2) Monkey-patch LGraphCanvas.prototype.processKey — blocks LiteGraph
//    key processing (delete nodes, copy, paste, etc.).
//
// 3) Focus-trap <textarea> inside each editor overlay — ComfyUI's
//    keybinding service skips ALL shortcuts when document.activeElement
//    is an INPUT or TEXTAREA, so keeping focus on our hidden textarea
//    disables the remaining 30+ ComfyUI shortcuts (queue, save, toggle
//    panels, group nodes, etc.).

const EDITOR_SELECTORS = ".pix-editor, .ppx-overlay, .pcrop-overlay, .p3d-overlay, .pix-lbl-overlay";

// Layer 1: Block undo/redo graph loading
const _origLoadGraphData = app.loadGraphData.bind(app);
app.loadGraphData = async function (...args) {
    if (document.querySelector(EDITOR_SELECTORS)) return;
    return _origLoadGraphData(...args);
};

// Layer 2: Block LiteGraph key processing
if (typeof LGraphCanvas !== "undefined") {
    const _origProcessKey = LGraphCanvas.prototype.processKey;
    LGraphCanvas.prototype.processKey = function (e) {
        if (document.querySelector(EDITOR_SELECTORS)) return;
        return _origProcessKey.apply(this, arguments);
    };
}

// Layer 3: Focus-trap helper — each editor calls this on its overlay.
// Creates a hidden textarea that keeps focus, making ComfyUI's
// keybinding service think the user is typing in a text field.
export function installFocusTrap(overlay) {
    const trap = document.createElement("textarea");
    trap.dataset.pixaromaTrap = "1";
    trap.setAttribute("aria-hidden", "true");
    trap.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
    overlay.appendChild(trap);
    trap.focus();
    // Re-focus trap when user clicks on non-input areas of the overlay
    const refocus = (e) => {
        const tag = e.target?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
            requestAnimationFrame(() => trap.focus());
        }
    };
    overlay.addEventListener("mouseup", refocus);
    return trap;
}

let _logoCache = null;
let _logoLoading = false;
let _logoCbs = [];

function getLogo(cb) {
    if (_logoCache) { cb(_logoCache); return; }
    _logoCbs.push(cb);
    if (_logoLoading) return;
    _logoLoading = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { _logoCache = img; _logoCbs.forEach(fn => fn(img)); _logoCbs = []; };
    img.onerror = () => { _logoCbs.forEach(fn => fn(null)); _logoCbs = []; };
    img.src = LOGO_URL;
}

export function createPlaceholder(name, buttonLabel, node, app) {
    getLogo((logo) => {
        const cvs = document.createElement("canvas");
        cvs.width = 480; cvs.height = 270;
        const ctx = cvs.getContext("2d");
        ctx.fillStyle = "#171718"; ctx.fillRect(0, 0, 480, 270);
        // Subtle grid
        ctx.strokeStyle = "rgba(255,255,255,0.03)"; ctx.lineWidth = 0.5;
        for (let x = 0; x < 480; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 270); ctx.stroke(); }
        for (let y = 0; y < 270; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(480, y); ctx.stroke(); }
        // Logo
        if (logo) ctx.drawImage(logo, 220, 65, 40, 40);
        // Text
        ctx.fillStyle = "#fff"; ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(name, 240, 128);
        ctx.fillStyle = BRAND;
        ctx.fillText("Pixaroma", 240, 150);
        ctx.fillStyle = "#555"; ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
        ctx.fillText("Click '" + buttonLabel + "' to start", 240, 175);
        // Apply
        const prev = new Image();
        prev.onload = () => {
            node.imgs = [prev];
            resizeNode(node, prev, app);
        };
        prev.src = cvs.toDataURL();
    });
}

export function resizeNode(node, img, app) {
    node.size[0] = Math.max(node.size[0] || BASE_WIDTH, BASE_WIDTH);
    const aspect = img.naturalWidth / img.naturalHeight;
    node.size[1] = (node.size[0] / aspect) + 80;
    app.graph.setDirtyCanvas(true, true);
}

export function hideJsonWidget(widgets, widgetName) {
    const w = (widgets || []).find(x => x.name === widgetName);
    if (w) {
        // Do NOT change w.type — ComfyUI uses it for prompt serialization.
        // Changing type to "hidden" can cause the widget to be skipped,
        // resulting in the Python node receiving the default value.
        w.hidden = true;
        w.computeSize = () => [0, -4];
        if (w.element) w.element.style.display = "none";
        // Delayed hide: DOM element may not exist yet during onNodeCreated
        requestAnimationFrame(() => {
            if (w.element) w.element.style.display = "none";
            if (w.inputEl) w.inputEl.style.display = "none";
        });
    }
    return w;
}

export function restorePreview(node, widgetName, app) {
    const w = (node.widgets || []).find(x => x.name === widgetName);
    if (!w?.value || w.value === "{}") return;
    try {
        const meta = JSON.parse(w.value);
        if (!meta.composite_path) return;
        const img = new Image();
        img.onload = () => { node.imgs = [img]; app.graph.setDirtyCanvas(true, true); };
        const fn = meta.composite_path.split(/[\\/]/).pop();
        img.src = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
    } catch (e) { console.warn("[Pixaroma] restore failed:", e); }
}

export { BASE_WIDTH, BRAND };
