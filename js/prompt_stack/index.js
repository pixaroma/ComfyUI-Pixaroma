import { app } from "/scripts/app.js";
import {
  readState,
  restoreFromProperties,
  addRow,
  deleteRow,
  toggleEnabled,
  reorderRows,
  clearAllText,
  resetToDefault,
} from "./core.mjs";
import { injectCSS, buildRoot, renderRows, measureContentHeight } from "./render.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";
import { pixConfirm } from "./interaction.mjs";

const DEFAULT_W = 400;
const DEFAULT_H = 180;
// Resize-handle floor (CLAUDE.md UI conventions #7). Sized so the bottom
// action row (3 buttons * 86 border-box + 2 * 4 gaps + root padding ~=
// 282) plus a small breathing margin fits without clipping. MIN_H stays
// at DEFAULT_H so a single-row node never collapses below its starting
// size; the user can still grow the node arbitrarily large.
const MIN_W = 320;
const MIN_H = 180;

// Defensive cleanup for nodes carried over from the older wire-mode version
// of this node (or from any future ComfyUI build that decides to auto-create
// slots from a stale INPUT_TYPES). Walks node.inputs and strips any leftover
// wire_* entries so the node renders cleanly.
function stripLegacyWireSlots(node) {
  if (!node.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const inp = node.inputs[i];
    if (inp && typeof inp.name === "string" && inp.name.startsWith("wire_")) {
      node.removeInput(i);
    }
  }
}

// growNodeToContent: ensure node.size[1] is tall enough for the actual rendered
// DOM widget content. Uses measureContentHeight (sum of children) rather than
// node.computeSize (which can over-report). Adds an allowance for title + top
// padding. Never shrinks (so a user-resized-bigger node stays the size they chose).
// Commit a new node height. A bare `node.size[1] = h` array-index write can
// be silently reverted by Nodes 2.0's reactive layout when the node was last
// sized in the OTHER renderer (the cross-renderer shrink-on-reset bug: rows
// grown in legacy, switch to Nodes 2.0, Reset → node stayed tall because the
// height write didn't stick). LiteGraph's setSize() commits through the
// official resize path so the new height holds in both renderers. Keep the
// direct write too as a belt-and-braces for builds without setSize.
function setNodeHeight(node, h) {
  node.size[1] = h;
  node.setSize?.([node.size[0], h]);
}

function growNodeToContent(node) {
  const root = node._pixPsRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  // ~30 title + ~10 body top padding + ~10 body bottom padding (breathing room)
  const desired = contentH + 50;
  if (desired > node.size[1]) setNodeHeight(node, desired);
}

// fitNodeToContent: shrink-and-grow. Used after explicit user actions (e.g.
// row delete) where the user is signalling "compact the node". Never shrinks
// below DEFAULT_H so a 1-row state still looks intentional.
function fitNodeToContent(node) {
  const root = node._pixPsRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = Math.max(DEFAULT_H, contentH + 50);
  setNodeHeight(node, desired);
}

function makeHandlers(node, root) {
  const rerender = () => {
    renderRows(node, root, handlers);
    requestAnimationFrame(() => {
      growNodeToContent(node);
      node.setDirtyCanvas(true, true);
    });
  };
  const handlers = {
    onToggleEnabled: (id) => { toggleEnabled(node, id); rerender(); },
    onLabelChange: (_id, _v) => { /* handled inline by attachLabelEditor */ },
    onTextChange: (_id, _v) => { /* handled inline by attachTextareaEditor */ },
    onDelete: async (id) => {
      const state = readState(node);
      const row = state.rows.find((r) => r.id === id);
      const hasContent = row && ((row.text && row.text.trim()) || (row.label && row.label.trim()));
      if (hasContent) {
        const labelOrIdx = (row.label && row.label.trim()) || `Row ${state.rows.indexOf(row) + 1}`;
        const ok = await pixConfirm({
          title: "Delete row?",
          message: `Are you sure you want to delete "${labelOrIdx}"?`,
          okText: "Delete",
          cancelText: "Cancel",
        });
        if (!ok) return;
      }
      deleteRow(node, id);
      rerender();
      // After delete, also fit the node down so the freed-up space doesn't
      // leave a gap. Defer past the rAF inside rerender so the DOM is
      // already updated when we measure.
      requestAnimationFrame(() => {
        fitNodeToContent(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onAdd: () => { addRow(node); rerender(); },
    onClearAll: async () => {
      const state = readState(node);
      const filled = state.rows.filter((r) => r.text && r.text.trim()).length;
      if (filled === 0) return;
      const ok = await pixConfirm({
        title: "Clear all text?",
        message: `This will empty the text in all ${state.rows.length} row${state.rows.length === 1 ? "" : "s"}. Labels and ON/OFF toggles are kept.`,
        okText: "Clear",
        cancelText: "Cancel",
      });
      if (!ok) return;
      clearAllText(node);
      rerender();
    },
    onReset: async () => {
      const ok = await pixConfirm({
        title: "Reset to default?",
        message: "This will replace all rows with one empty row, ON, no label. Your current rows will be lost.",
        okText: "Reset",
        cancelText: "Cancel",
      });
      if (!ok) return;
      resetToDefault(node);
      rerender();
      requestAnimationFrame(() => {
        fitNodeToContent(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onDragStart: (_id, _ev) => { /* Task 9 */ },
    onDragOver: (_id, _ev) => { /* Task 9 */ },
    onDrop: (fromId, toId, above) => {
      const state = readState(node);
      const fromIdx = state.rows.findIndex((r) => r.id === fromId);
      const toIdxRaw = state.rows.findIndex((r) => r.id === toId);
      if (fromIdx < 0 || toIdxRaw < 0) return;
      // Compute final destination index: if dropping ABOVE the target, the new
      // index is the target's index (target shifts down). If dropping BELOW,
      // the new index is target + 1. Account for the removed source slot when
      // it was before destination (splice logic shifts).
      let destIdx = above ? toIdxRaw : toIdxRaw + 1;
      if (fromIdx < destIdx) destIdx -= 1;
      if (destIdx === fromIdx) return;
      reorderRows(node, fromIdx, destIdx);
      rerender();
    },
    onDragEnd: (_ev) => { /* Task 9 */ },
  };
  return { handlers, rerender };
}

app.registerExtension({
  name: "Pixaroma.PromptStack",

  settings: [
    {
      id: "Pixaroma.PromptStack.SeparatorText",
      name: "Separator",
      type: "text",
      defaultValue: ", ",
      tooltip: "What goes between enabled rows in the joined output. Edit directly. Examples: ', ' (default comma+space), '\\n' for newline (type backslash + n), ' ' for a single space, ' | ' for pipe. Clear the field to reset to the default ', '.",
      category: ["👑 Pixaroma", "Prompt Stack"],
      onChange: (v) => {
        // Empty field acts as "reset to default" - refill with ", " so the
        // user can see and edit the actual current value next time.
        if (typeof v === "string" && v.length === 0) {
          try {
            app.ui?.settings?.setSettingValue?.("Pixaroma.PromptStack.SeparatorText", ", ");
          } catch (_e) {}
        }
      },
    },
  ],

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptStack") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      queueMicrotask(() => {
        injectCSS();
        stripLegacyWireSlots(node);
        restoreFromProperties(node);

        const root = buildRoot();
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixPsRoot = root;
        node._pixPsRerender = rerender;
        // DOM-only render (no auto-grow). Used on workflow load so the saved
        // node.size is trusted - the grow path rewrites node.size by a few px
        // (DOM measurement rounding) which would falsely flag the workflow
        // "modified" on a plain open. Auto-grow stays on the user-action
        // handlers (add/delete/text) where a size change is legitimate.
        node._pixPsRenderOnly = () => renderRows(node, root, handlers);

        const _psWidget = node.addDOMWidget("promptstack", "div", root, {
          serialize: false,
          // canvasOnly set adaptively below (CLAUDE.md Nodes 2.0): true in
          // legacy (out of Parameters tab), false in Nodes 2.0 (Vue body).
          getMinHeight: () => measureContentHeight(root),
        });
        applyAdaptiveCanvasOnly(_psWidget);

        // Expose a tiny grow helper so interaction handlers (textarea
        // autogrow) can ask the node to expand without doing a full rerender.
        node._pixPsGrow = () => {
          growNodeToContent(node);
          node.setDirtyCanvas(true, true);
        };

        node._pixPsRenderOnly();

        if (node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
        if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      stripLegacyWireSlots(this);
      restoreFromProperties(this);
      // DOM-only render on load (no auto-grow) so the saved node.size is
      // preserved and the workflow isn't falsely flagged "modified".
      if (this._pixPsRenderOnly) this._pixPsRenderOnly();
      return r;
    };

    // Clamp manual resize so the bottom action row never overflows past
    // the node frame. Mutate BOTH the parameter AND this.size defensively
    // (some LiteGraph forks treat the param as the new size).
    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < MIN_W) size[0] = MIN_W;
      if (size[1] < MIN_H) size[1] = MIN_H;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    // Self-heal min size on every paint (Preview Image Pattern #11).
    // Catches resize paths that bypass onResize per Vue Compat #13 -
    // some DOM-widget resizes never fire onResize, and Align Pixaroma
    // can write node.size directly via cursor delta.
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPsRoot = null;
      this._pixPsRerender = null;
      this._pixPsRenderOnly = null;
      this._pixPsGrow = null;
      this._pixPsRefreshClear = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// app.graphToPrompt hook - injects state + resolved separator into the hidden
// PromptStackState input at workflow-submit time. Pattern #9 (Vue Frontend
// Compatibility). Subgraph-safe via tail-id matching.
const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const sep = resolveSeparator();
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptStack") continue;
        // Tail-id matching: find the node by id suffix (subgraphs prefix the id with "x:y:")
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        if (!node) continue;
        const state = node.properties?.promptStackState;
        if (!state || !Array.isArray(state.rows)) continue;
        const payload = JSON.stringify({
          version: 1,
          rows: state.rows.map((r) => ({
            enabled: !!r.enabled,
            label: r.label || "",
            text: r.text || "",
          })),
          separator: sep,
        });
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptStackState = payload;
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptStack: graphToPrompt hook failed", err);
  }
  return result;
};

function resolveSeparator() {
  const raw = app.ui?.settings?.getSettingValue?.("Pixaroma.PromptStack.SeparatorText");
  if (typeof raw !== "string" || raw.length === 0) return ", ";
  // Interpret \n (backslash + n) as a newline and \t as a tab so users can
  // express those in a single-line text input. Anything else stays literal.
  return raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}
