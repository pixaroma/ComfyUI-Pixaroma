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
import { applyAdaptiveCanvasOnly, installResizeFloor, isVueNodes } from "../shared/index.mjs";
import { pixConfirm, autoGrowTextareas } from "./interaction.mjs";

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

// Chrome the node height must budget for ABOVE the DOM body that
// measureContentHeight does NOT include: the title bar PLUS one row per output
// slot (Prompt Stack has one output: text). Computed from the live slot count so
// it stays correct if the slots ever change. For one output this equals the old
// fixed 50 (~30 title + ~20 slot), so existing nodes keep their height (no
// dirty-on-load); the body's own bottom padding is the margin.
function chromeAllowance(node) {
  const LG = window.LiteGraph || {};
  const titleH = LG.NODE_TITLE_HEIGHT || 30;
  const slotH = LG.NODE_SLOT_HEIGHT || 20;
  const slots = Math.max(node.outputs?.length || 0, node.inputs?.length || 0);
  return titleH + slots * slotH;
}

function growNodeToContent(node) {
  const root = node._pixPsRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = contentH + chromeAllowance(node);
  if (desired > node.size[1]) setNodeHeight(node, desired);
}

// fitNodeToContent: shrink-and-grow. Used after explicit user actions (e.g.
// row delete) where the user is signalling "compact the node". Never shrinks
// below DEFAULT_H so a 1-row state still looks intentional.
function fitNodeToContent(node) {
  const root = node._pixPsRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = Math.max(DEFAULT_H, contentH + chromeAllowance(node));
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
        // Floor the node at its content height while a resize handle is dragged
        // (Nodes 2.0) so the bottom button row can't be squished out of frame.
        node._pixPsFloorOff = installResizeFloor(root, measureContentHeight);

        // Re-grow textareas whenever the body becomes visible again (workflow
        // load / tab switch / collapse-expand) or the node width changes. The
        // one-shot rAF in attachTextareaEditor measures once and reads
        // scrollHeight 0 while the body is hidden, so multi-line fields collapse
        // to min height until the user pokes them - this restores them. Gated on
        // a WIDTH change so our own height edits don't re-trigger it (no loop);
        // never touches node.size, so it is dirty-on-load safe.
        let _psLastW = -1;
        const _psRO = new ResizeObserver(() => {
          const w = root.clientWidth;
          if (w === _psLastW) return;
          _psLastW = w;
          autoGrowTextareas(root);
        });
        _psRO.observe(root);
        node._pixPsRO = _psRO;

        // Expose a tiny grow helper so interaction handlers (textarea
        // autogrow) can ask the node to expand without doing a full rerender.
        node._pixPsGrow = () => {
          growNodeToContent(node);
          node.setDirtyCanvas(true, true);
        };

        node._pixPsRenderOnly();

        // Default size on FRESH placement only. onConfigure sets _pixPsConfigured
        // for a loaded workflow (runs before this microtask), so a saved size -
        // even one the user shrank below DEFAULT - is kept and doesn't jump back
        // to default on a workflow switch.
        if (!node._pixPsConfigured) {
          if (node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
          if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
        }
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      this._pixPsConfigured = true;
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
      // LEGACY ONLY - in Nodes 2.0 the rendered size lives in the Vue layout
      // store, not node.size; clamping node.size here desyncs them and the node
      // jumps to the clamped size on a workflow switch. Nodes 2.0 floors via
      // MIN_NODE_WIDTH + the resize-floor helper.
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    // Self-heal min size on every paint (Preview Image Pattern #11). LEGACY
    // ONLY (see onResize) - it would desync node.size from the Vue layout.
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (isVueNodes()) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPsFloorOff?.();
      this._pixPsFloorOff = null;
      this._pixPsRO?.disconnect();
      this._pixPsRO = null;
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
// Subgraph-safe node lookup: ComfyUI flattens subgraph-contained nodes into the
// prompt with composite IDs ("5:12") that app.graph.getNodeById (top-level only)
// can't resolve, so a plain parseInt(tail)+getNodeById silently missed any node
// inside a subgraph (state never injected). Walk every nested subgraph instead
// (mirrors js/text_overlay/index.js + js/find_replace/index.js).
function buildPixPsNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaPromptStack" || n.type === "PixaromaPromptStack") index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}
function findPixPsNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const sep = resolveSeparator();
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      let index = null;
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptStack") continue;
        if (!index) index = buildPixPsNodeIndex();
        const node = findPixPsNode(index, key);
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
