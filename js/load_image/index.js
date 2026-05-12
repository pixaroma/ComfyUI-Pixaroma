import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget } from "../shared/index.mjs";
import {
  injectCSS, buildRoot, hideNativeImageCombo, openImageDropdown,
  renderChips, renderGlobalControls,
} from "./ui.mjs";
import { pickAndUploadFile, pasteFromClipboard, uploadImageToInput } from "./api.mjs";
import { buildModePanel, previewResize, formatMP } from "./resize_modes.mjs";

let _activeLoadImageNode = null;

function refreshDropdown(node) {
  const dd = node._pixLiRoot?.querySelector('[data-role="dropdown"] .name');
  if (!dd) return;
  const w = node._pixLiImageWidget;
  dd.textContent = (w?.value && w.value !== "") ? w.value : "— no image —";
}

function renderUI(node) {
  const root = node._pixLiRoot;
  if (!root) return;
  // No `isConnected` check: queueMicrotask fires BEFORE LiteGraph's first
  // canvas paint, so the DOM widget root isn't attached to the document yet.
  // We still want to append chips to root (in memory). When LiteGraph paints
  // the node, root + chips will be visible. Same pattern as Resolution
  // Pixaroma's deferred initial render.
  const state = readState(node);

  // We keep the upload button + hint + dropdown stable across renders.
  // Re-render only the dynamic parts: chip grid and the per-mode panel.

  let chipsEl = root.querySelector(".pix-li-chips");
  const newChips = renderChips(state);
  if (chipsEl) chipsEl.replaceWith(newChips);
  else root.appendChild(newChips);

  // Remove the previous panel (if any) and append the new one for the current mode.
  const oldPanel = root.querySelector(".pix-li-panel");
  if (oldPanel) oldPanel.remove();
  const panel = buildModePanel(state.mode, node, state, writeState, () => { /* onChange is intentionally a no-op for leaf events (input
       commits, quick-pick clicks, color picks). Re-rendering the panel from
       a leaf event destroyed the focused input and broke Arrow / Tab keys.
       State is written by the leaf's writeState call; that's all we need.
       When B4 adds a live preview badge, this becomes a non-destructive
       "update badge" call. */ });
  if (panel) {
    // Insert AFTER the chip grid.
    const chips = root.querySelector(".pix-li-chips");
    chips.after(panel);
  }

  // Remove old global controls (if any) and re-render.
  const oldGlobal = root.querySelector(".pix-li-global");
  if (oldGlobal) oldGlobal.remove();
  const globals = renderGlobalControls(node, state, writeState, () => { /* onChange is intentionally a no-op for leaf events (input
       commits, quick-pick clicks, color picks). Re-rendering the panel from
       a leaf event destroyed the focused input and broke Arrow / Tab keys.
       State is written by the leaf's writeState call; that's all we need.
       When B4 adds a live preview badge, this becomes a non-destructive
       "update badge" call. */ });
  root.appendChild(globals);

  // Force an immediate resize ONLY when the content height actually
  // changed (mode switch). Without this, switching to a taller panel
  // takes 1-3 seconds because LiteGraph doesn't auto-adjust node.size
  // when getMinHeight changes — it only re-measures during certain
  // lifecycle events. Gating on "did height change" preserves the user's
  // manual resize: snap / resample / upscale clicks also call renderUI
  // but don't change content height, so we leave node.size alone there.
  const newH = node._pixLiMeasureHeight?.();
  if (typeof newH === "number" && newH !== node._pixLiLastMeasuredH) {
    node._pixLiLastMeasuredH = newH;
    if (typeof node.computeSize === "function") {
      const min = node.computeSize();
      if (Array.isArray(min) && min.length === 2) {
        node.size[1] = min[1];
      }
    }
  }
  node.graph?.setDirtyCanvas?.(true, true);
}

// Global Ctrl+V handler for the active load-image node.
window.addEventListener("keydown", async (e) => {
  if (!_activeLoadImageNode) return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "v") return;
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.target?.isContentEditable) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    const saved = await pasteFromClipboard(_activeLoadImageNode);
    if (saved) refreshDropdown(_activeLoadImageNode);
  } catch (err) {
    console.error("[PixaromaLoadImage] paste failed", err);
    alert("Paste failed: " + err.message);
  }
}, true);

// State pattern mirrors Resolution Pixaroma (CLAUDE.md Vue Compat #9):
// hidden Python input + node.properties + app.graphToPrompt injection.
const STATE_PROP = "loadImagePixState";
const HIDDEN_INPUT_NAME = "LoadImagePixState";

export const DEFAULT_STATE = {
  version: 1,
  mode: "off",
  max_mp: 1.0,
  longest_side: 1024,
  scale_factor: 1.0,
  fit_w: 1024, fit_h: 1024,
  cover_w: 1024, cover_h: 1024,
  ratio_preset: "1:1",
  ratio_w: 1, ratio_h: 1,
  ratio_action: "crop",
  pad_color: "#000000",
  snap: 0,
  resample: "auto",
  allow_upscale: true,
};

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; }
    catch { /* fall through */ }
  }
  return { ...DEFAULT_STATE };
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

function setupLoadImageNode(node) {
  injectCSS();
  hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);

  // Hide the native `image` combo — our custom dropdown replaces it visually
  // but reads/writes through its `.value`.
  const imageWidget = hideNativeImageCombo(node);
  node._pixLiImageWidget = imageWidget;

  if (!node.color) node.color = "#1d1d1d";
  if (!node.bgcolor) node.bgcolor = "#2a2a2a";

  const root = buildRoot();
  node._pixLiRoot = root;

  // Intrinsic content-height measurement. We DO NOT use root.scrollHeight
  // or root.offsetHeight here: LiteGraph stretches root vertically when the
  // node is taller than minimum, and reading the stretched value creates a
  // feedback loop (every paint reports the new larger height → node grows
  // → next paint reports even larger → user can never shrink, and a
  // duplicated node inherits the inflated minimum). Instead, sum each
  // child's natural offsetHeight (which is intrinsic to the child, NOT
  // influenced by root's stretched size) plus flex gaps and root padding.
  function measureContentHeight() {
    let totalH = 0;
    let visible = 0;
    for (const child of root.children) {
      const style = window.getComputedStyle(child);
      if (style.position === "absolute" || style.position === "fixed") continue;
      if (style.display === "none") continue;
      totalH += child.offsetHeight;
      visible += 1;
    }
    const padding = 16; // root padding: 8px top + 8px bottom
    const gaps = Math.max(0, visible - 1) * 8; // flex `gap: 8px` between children
    return Math.max(280, totalH + padding + gaps);
  }
  node._pixLiMeasureHeight = measureContentHeight;

  const widget = node.addDOMWidget("pixaroma_load_image_ui", "custom", root, {
    canvasOnly: true,  // Vue Compat #15 — hide from Parameters tab
    getValue: () => null,
    setValue: () => {},
    getMinHeight: measureContentHeight,
    margin: 4,
    serialize: false,
  });
  node._pixLiWidget = widget;

  // Track the currently-focused load-image node for Ctrl+V routing.
  // (One global listener; nodes register/unregister themselves on selection.)
  node._pixLiOnSelected = () => { _activeLoadImageNode = node; };
  node._pixLiOnDeselected = () => {
    if (_activeLoadImageNode === node) _activeLoadImageNode = null;
  };

  // Wire upload button.
  const btn = root.querySelector(".pix-li-upload-btn");
  btn?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const saved = await pickAndUploadFile(node);
      if (saved) refreshDropdown(node);
    } catch (err) {
      console.error("[PixaromaLoadImage] upload failed", err);
      alert("Upload failed: " + err.message);
    }
  });

  // Drag/drop on the root.
  root.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    root.classList.add("drag-over");
  });
  root.addEventListener("dragleave", (e) => {
    if (e.target === root) root.classList.remove("drag-over");
  });
  root.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    root.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      await uploadImageToInput(node, file);
      refreshDropdown(node);
    } catch (err) {
      console.error("[PixaromaLoadImage] drop upload failed", err);
      alert("Upload failed: " + err.message);
    }
  });

  // Custom dropdown click → popup.
  const dd = root.querySelector('[data-role="dropdown"]');
  dd?.addEventListener("click", (e) => {
    e.stopPropagation();
    openImageDropdown(node, dd, () => refreshDropdown(node));
  });

  // Initial dropdown sync (defer so the native combo's `value` is restored).
  queueMicrotask(() => refreshDropdown(node));

  // Chip click → update state + re-render.
  root.addEventListener("click", (e) => {
    const chip = e.target.closest(".pix-li-chip");
    if (!chip) return;
    e.stopPropagation();
    const mode = chip.dataset.modeId;
    if (!mode) return;
    const cur = readState(node);
    if (cur.mode === mode) return;
    writeState(node, { ...cur, mode });
    renderUI(node);
  });

  // Initial render — defer so configure() has time to land state.
  queueMicrotask(() => { /* onChange is intentionally a no-op for leaf events (input
       commits, quick-pick clicks, color picks). Re-rendering the panel from
       a leaf event destroyed the focused input and broke Arrow / Tab keys.
       State is written by the leaf's writeState call; that's all we need.
       When B4 adds a live preview badge, this becomes a non-destructive
       "update badge" call. */ });
}

app.registerExtension({
  name: "Pixaroma.LoadImage",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaLoadImage") return;
    const _origSel = nodeType.prototype.onSelected;
    const _origDes = nodeType.prototype.onDeselected;
    nodeType.prototype.onSelected = function () {
      this._pixLiOnSelected?.();
      return _origSel?.apply(this, arguments);
    };
    nodeType.prototype.onDeselected = function () {
      this._pixLiOnDeselected?.();
      return _origDes?.apply(this, arguments);
    };
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      // Wait a microtask so widget values are settled.
      queueMicrotask(() => refreshDropdown(this));
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaLoadImage") return;
    setupLoadImageNode(node);
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ──────────────────────────────
// Same walk-and-inject pattern as Resolution Pixaroma's index.js. Required
// because LoadImagePixState is `hidden` (no widget) so the workflow JSON
// doesn't carry it; we inject from node.properties at submission time.

function buildPixaromaNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaLoadImage" || n.type === "PixaromaLoadImage") {
        index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findPixaromaNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== "PixaromaLoadImage") continue;
      if (!index) index = buildPixaromaNodeIndex();
      const node = findPixaromaNode(index, id);
      const state = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = state;
    }
  }
  return result;
};
