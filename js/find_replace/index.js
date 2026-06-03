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
  STATE_PROP,
} from "./core.mjs";
import {
  injectCSS,
  buildRoot,
  renderAll,
  renderPreview,
  refreshResetState,
  measureMinHeight,
} from "./render.mjs";
import { pixConfirm, autoGrowAllFields } from "./interaction.mjs";
import { applyAdaptiveCanvasOnly, installResizeFloor, isVueNodes, closeHelpPopup } from "../shared/index.mjs";

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
  node._pixFrAutoH = h; // remember the height WE set, to tell auto-fit from a manual resize
}

// Grow the node so the fixed parts (toggles + rules + actions) plus a minimum
// preview always fit. Grows only, and ONLY on user actions (add/delete/reset/
// execute) - never on the load path. The squish FLOOR is handled purely in CSS
// now (the root's natural min-content height; see render.mjs), so there is no
// ResizeObserver / root.style.minHeight machinery to fight the layout or Align.
// Re-fit the node height to its content. TWO-WAY: grows to fit, and shrinks
// back to content when the user has NOT manually enlarged the node beyond the
// last auto height (so someone who dragged it taller for a big preview keeps
// their size, but clearing a multi-line field or deleting rows reclaims the
// space instead of leaving dead area - the Nodes 2.0 "grows but never shrinks"
// wart). Floors at DEFAULT_H. ONLY call from user-action handlers (add / delete
// / edit / drop) - never on the load path, or it would rewrite node.size and
// false-dirty the workflow (Vue Compat #18). Always includes CHROME so the
// frame contains the widget in Nodes 2.0.
function refitNode(node) {
  const root = node._pixFrRoot;
  if (!root) return;
  const want = Math.max(measureMinHeight(root) + CHROME, DEFAULT_H);
  const cur = node.size[1];
  const autoH = node._pixFrAutoH;
  const userEnlarged = autoH != null && cur > autoH + 4;
  let target = cur;
  if (want > cur) target = want;                       // always grow to fit
  else if (!userEnlarged && want < cur) target = want; // shrink to content if not user-enlarged
  if (target !== cur) setNodeHeight(node, target);
}

// Force the node back to a comfortable default height (used on Reset only -
// deliberately discards any manual enlargement).
function fitToDefault(node) {
  const root = node._pixFrRoot;
  if (!root) return;
  setNodeHeight(node, Math.max(measureMinHeight(root) + CHROME, DEFAULT_H));
}

function makeHandlers(node, root) {
  const rerender = () => {
    renderAll(node, root, handlers);
    requestAnimationFrame(() => {
      refitNode(node);
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
        // Own a PRIVATE deep copy of the state so a pasted/cloned node can't
        // share the original's rules array by reference (then editing the copy
        // would mutate the original). The clone is byte-identical, so this does
        // NOT dirty a loaded workflow.
        const _st = node.properties?.[STATE_PROP];
        if (_st) {
          try { node.properties[STATE_PROP] = JSON.parse(JSON.stringify(_st)); } catch (_e) {}
        }

        const root = buildRoot();
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixFrRoot = root;
        node._pixFrRerender = rerender;
        // DOM-only render (no auto-grow) - used on load so the saved node.size
        // is trusted and the workflow isn't falsely flagged "modified".
        node._pixFrRenderOnly = () => renderAll(node, root, handlers);
        node._pixFrRefreshPreview = () => renderPreview(node, root);
        node._pixFrRefreshReset = () => refreshResetState(node, root);
        node._pixFrRefit = () => { refitNode(node); node.setDirtyCanvas(true, true); };

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
        // Floor the node at its content height WHILE a resize handle is dragged
        // (Nodes 2.0 only) so the buttons/preview can't be squished out of frame.
        node._pixFrFloorOff = installResizeFloor(root, measureMinHeight);

        // Re-measure the find/replace fields when the node WIDTH changes, so a
        // field whose content wrapped (and grew) at a narrow width shrinks back
        // when the node is widened. Width-gated to avoid a height feedback loop.
        try {
          let lastW = root.clientWidth;
          const ro = new ResizeObserver(() => {
            const w = root.clientWidth;
            if (w !== lastW) { lastW = w; autoGrowAllFields(root); }
          });
          ro.observe(root);
          node._pixFrFieldRO = ro;
        } catch (_e) {}

        // Open at a comfortable default size on FRESH placement only. onConfigure
        // sets _pixFrConfigured for a loaded workflow (it runs before this
        // microtask), so a saved size - even one the user shrank below DEFAULT -
        // is kept as-is and does NOT jump back to default on a workflow switch.
        if (!node._pixFrConfigured) {
          const w = Math.max(node.size[0], DEFAULT_W);
          const h = Math.max(node.size[1], DEFAULT_H);
          if (w !== node.size[0] || h !== node.size[1]) {
            node.size[0] = w;
            node.size[1] = h;
            node.setSize?.([w, h]);
          }
        }
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      // Mark this node as loaded-from-a-workflow so the onNodeCreated microtask
      // keeps the saved size instead of forcing DEFAULT_H. DOM-only render, no
      // size write - the load path must not touch node.size (Vue Compat #18).
      this._pixFrConfigured = true;
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
          // Do NOT resize here. A Run never changes the rule count, so the
          // height floor is unchanged and the preview (a flex area) absorbs any
          // slack. Resizing on every Run rewrote node.size, which (a) falsely
          // flagged the workflow "modified" on a plain Run, and (b) could fire a
          // setSize mid-interaction and desync Align's resize guard. Just
          // repaint the preview.
          this.setDirtyCanvas(true, true);
        }
      } catch (err) {
        console.error("Pixaroma.FindReplace: onExecuted failed", err);
      }
    };

    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      // LEGACY ONLY. In Nodes 2.0 the rendered size lives in the Vue layout
      // store, NOT node.size; clamping node.size here desyncs the two, and on a
      // workflow switch the node is rebuilt from the (clamped, bigger) node.size
      // and JUMPS to it. Nodes 2.0 floors width via MIN_NODE_WIDTH + the
      // resize-floor (height), so the clamp is not needed there.
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (isVueNodes()) return; // legacy-only clamp (see onResize)
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      // Close any open Help panel so its document-level Esc listener can't leak
      // when the node is deleted while the panel is open (no-op if none open).
      closeHelpPopup();
      this._pixFrFloorOff?.();
      this._pixFrFloorOff = null;
      this._pixFrFieldRO?.disconnect();
      this._pixFrFieldRO = null;
      this._pixFrRoot = null;
      this._pixFrRerender = null;
      this._pixFrRenderOnly = null;
      this._pixFrRefreshPreview = null;
      this._pixFrRefreshReset = null;
      this._pixFrRefit = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// graphToPrompt hook - inject the rules state (WITHOUT the preview) into the
// hidden FindReplaceState input at submit time. Pattern #9.
//
// Subgraph-safe: ComfyUI flattens subgraph-contained nodes into the API prompt
// with composite IDs ("5:12"), and app.graph.getNodeById only exposes top-level
// nodes - so a plain parseInt(tail) + getNodeById silently missed any Find and
// Replace placed inside a subgraph (rules never injected -> node became a near
// no-op). Resolve via a recursive index over every nested subgraph instead
// (mirrors js/text_overlay/index.js and js/resolution/index.js).
function buildPixFrNodeIndex() {
  // Key by the COMPOSITE path id ("5:12" for a node inside subgraph-node 5) so
  // two subgraphs that each contain an FR node with the same inner id ("5:12"
  // vs "7:12") don't collide on the bare tail "12" (the old String(n.id) key
  // overwrote one with the other, injecting the wrong rules). The prompt key
  // from graphToPrompt for a nested node IS this composite form.
  const index = new Map(); // composite id ("5:12") OR bare id -> node
  const visit = (graph, prefix) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      const fullId = prefix + String(n.id);
      if (n.comfyClass === "PixaromaFindReplace" || n.type === "PixaromaFindReplace") {
        index.set(fullId, n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner, fullId + ":");
    }
  };
  visit(app.graph, "");
  return index;
}

function findPixFrNode(index, promptId) {
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
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      let index = null;
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaFindReplace") continue;
        if (!index) index = buildPixFrNodeIndex();
        const node = findPixFrNode(index, key);
        if (!node) continue;
        // Read through readState (not raw properties) so the injected payload is
        // normalized identically to what the on-node preview computes - a
        // malformed/legacy saved state can't make the real run diverge from the
        // preview (e.g. a row with a missing `enabled` would inject as OFF via
        // !!r.enabled while the preview treats it as ON).
        const state = readState(node);
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
