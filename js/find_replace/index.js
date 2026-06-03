import { app } from "/scripts/app.js";
import {
  readState,
  restoreFromProperties,
  addRule,
  deleteRule,
  toggleRuleEnabled,
  setToggle,
  reorderRules,
  resetToDefault,
  setPreviewInput,
} from "./core.mjs";
import {
  injectCSS,
  buildRoot,
  renderAll,
  renderPreview,
  refreshResetState,
  measureMinHeight,
} from "./render.mjs";
import { pixConfirm } from "./interaction.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";

const DEFAULT_W = 380;
const DEFAULT_H = 320;
const MIN_W = 340;
const MIN_H = 200;

// node.size is the WHOLE node (title bar + the text in/out slot row + the DOM
// widget). measureMinHeight() returns only the WIDGET content height, so we add
// CHROME (title + one slot row) on top when sizing the node. Legacy ComfyUI
// self-corrects via the widget's getMinHeight, but Nodes 2.0 honors node.size
// literally - without the chrome the body overflowed below the frame when rules
// were added.
const CHROME = 60;

// Commit a node height through setSize() so it sticks in BOTH renderers
// (a bare node.size[1] = h can be reverted by Nodes 2.0's reactive layout
// when the node was last sized in the other renderer). Keep the direct write
// as a fallback for builds without setSize. (CLAUDE.md Nodes 2.0.)
function setNodeHeight(node, h) {
  node.size[1] = h;
  node.setSize?.([node.size[0], h]);
}

// Grow the node so the fixed parts (toggles + rules + actions) plus a minimum
// preview always fit. Grows only - the preview flexes to fill any extra
// height, so freed space (e.g. a textarea shrinking) goes to the preview, not
// to a dead gap.
function ensureMinHeight(node) {
  const root = node._pixFrRoot;
  if (!root) return;
  // Grow-only: never shrink below the user's current size (preview absorbs
  // freed space). Always include CHROME so the node frame contains the widget
  // in Nodes 2.0. setSize fires only when the height actually changes (e.g.
  // adding a rule), which also forces Nodes 2.0 to re-lay-out and grow.
  const target = Math.max(node.size[1], measureMinHeight(root) + CHROME);
  if (target !== node.size[1]) setNodeHeight(node, target);
}

// Reset the node to a comfortable default height (used on Reset).
function fitToDefault(node) {
  const root = node._pixFrRoot;
  if (!root) return;
  setNodeHeight(node, Math.max(measureMinHeight(root) + CHROME, DEFAULT_H));
}

function makeHandlers(node, root) {
  const rerender = () => {
    renderAll(node, root, handlers);
    requestAnimationFrame(() => {
      ensureMinHeight(node);
      node.setDirtyCanvas(true, true);
    });
  };
  const handlers = {
    onToggleGlobal: (key) => { setToggle(node, key); rerender(); },
    onToggleRule: (id) => { toggleRuleEnabled(node, id); rerender(); },
    onAdd: () => { addRule(node); rerender(); },
    // Instant delete - no confirm (one rule is cheap to recreate, and the live
    // preview shows the effect). The delete button is disabled at 1 rule, so a
    // delete always leaves at least one. Reset (wipes everything) still confirms.
    onDelete: (id) => {
      deleteRule(node, id);
      rerender();
    },
    onReset: async () => {
      const ok = await pixConfirm({
        title: "Reset all rules?",
        message: "This clears every rule and puts the toggles back to defaults (Case off, Whole word off, Regex off, Tidy on).",
        okText: "Reset",
        cancelText: "Cancel",
      });
      if (!ok) return;
      resetToDefault(node);
      rerender();
      requestAnimationFrame(() => {
        fitToDefault(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onDrop: (fromId, toId, above) => {
      const state = readState(node);
      const fromIdx = state.rules.findIndex((r) => r.id === fromId);
      const toIdxRaw = state.rules.findIndex((r) => r.id === toId);
      if (fromIdx < 0 || toIdxRaw < 0) return;
      let destIdx = above ? toIdxRaw : toIdxRaw + 1;
      if (fromIdx < destIdx) destIdx -= 1;
      if (destIdx === fromIdx) return;
      reorderRules(node, fromIdx, destIdx);
      rerender();
    },
  };
  return { handlers, rerender };
}

app.registerExtension({
  name: "Pixaroma.FindReplace",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaFindReplace") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const root = buildRoot();
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixFrRoot = root;
        node._pixFrRerender = rerender;
        // DOM-only render (no auto-grow) - used on load so the saved node.size
        // is trusted and the workflow isn't falsely flagged "modified".
        node._pixFrRenderOnly = () => renderAll(node, root, handlers);
        node._pixFrRefreshPreview = () => renderPreview(node, root);
        node._pixFrRefreshReset = () => refreshResetState(node, root);
        node._pixFrGrow = () => { ensureMinHeight(node); node.setDirtyCanvas(true, true); };

        const widget = node.addDOMWidget("findreplace", "pixaroma_find_replace", root, {
          serialize: false,
          getMinHeight: () => measureMinHeight(root),
        });
        applyAdaptiveCanvasOnly(widget);
        // Nodes 2.0 sizes the widget through the CSS grid via computeLayoutSize
        // and IGNORES the legacy getMinHeight above - so without this the node
        // could be dragged smaller than its content and the body overflowed
        // below the frame. Give it the same fixed-parts + min-preview floor (and
        // it grows as rules are added). minWidth:1 so the saved node WIDTH still
        // round-trips on reload (CLAUDE.md Compare gotcha 2).
        widget.computeLayoutSize = () => ({ minHeight: measureMinHeight(root), minWidth: 1 });

        node._pixFrRenderOnly();

        // Open at a comfortable default size on fresh placement. Route through
        // setSize so the height actually sticks in Nodes 2.0 (a bare
        // node.size[1] write is reverted there). configure() runs before this
        // microtask for loaded workflows, so a saved (>= default) size wins and
        // setSize is skipped.
        const w = Math.max(node.size[0], DEFAULT_W);
        const h = Math.max(node.size[1], DEFAULT_H);
        if (w !== node.size[0] || h !== node.size[1]) {
          node.size[0] = w;
          node.size[1] = h;
          node.setSize?.([w, h]);
        }
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      if (this._pixFrRenderOnly) this._pixFrRenderOnly();
      return r;
    };

    // Capture the executed input/output so the live preview can show before/after
    // (and persist so a shared workflow shows it on open). The preview recomputes
    // the output from the CURRENT rules, so we only need the input here.
    const origExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      if (origExecuted) origExecuted.apply(this, arguments);
      try {
        const data = message?.pixaroma_find_replace?.[0];
        if (data && typeof data.input === "string") {
          setPreviewInput(this, data.input, !!data.truncated);
          if (this._pixFrRefreshPreview) this._pixFrRefreshPreview();
          requestAnimationFrame(() => {
            ensureMinHeight(this);
            this.setDirtyCanvas(true, true);
          });
        }
      } catch (err) {
        console.error("Pixaroma.FindReplace: onExecuted failed", err);
      }
    };

    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < MIN_W) size[0] = MIN_W;
      if (size[1] < MIN_H) size[1] = MIN_H;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixFrRoot = null;
      this._pixFrRerender = null;
      this._pixFrRenderOnly = null;
      this._pixFrRefreshPreview = null;
      this._pixFrRefreshReset = null;
      this._pixFrGrow = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// graphToPrompt hook - inject the rules state (WITHOUT the preview) into the
// hidden FindReplaceState input at submit time. Pattern #9, subgraph-safe via
// tail-id matching.
const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaFindReplace") continue;
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        if (!node) continue;
        const state = node.properties?.findReplaceState;
        if (!state || !Array.isArray(state.rules)) continue;
        const payload = JSON.stringify({
          version: 1,
          caseSensitive: !!state.caseSensitive,
          wholeWord: !!state.wholeWord,
          regex: !!state.regex,
          tidy: state.tidy !== false,
          rules: state.rules.map((r) => ({
            enabled: !!r.enabled,
            find: r.find || "",
            replace: r.replace || "",
          })),
        });
        entry.inputs = entry.inputs || {};
        entry.inputs.FindReplaceState = payload;
      }
    }
  } catch (err) {
    console.error("Pixaroma.FindReplace: graphToPrompt hook failed", err);
  }
  return result;
};
