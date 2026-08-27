import { app } from "/scripts/app.js";
import {
  readState, writeState, restoreFromProperties, DEFAULT_CAP,
} from "./core.mjs";
import { injectCSS, buildRoot, applyState, updateCount, placeBand } from "./ui.mjs";
import { buildPrompts } from "./expand.mjs";
import { openSettingsPanel, closeSettingsPanelFor, isPanelOpenFor } from "./settings.mjs";
import { PROMPT_EACH_HELP } from "./help.mjs";
import {
  applyAdaptiveCanvasOnly, installResizeFloor, measureRootContent, isVueNodes,
  installCanvasZoomPassthrough, installNativeTextMenu, installNodeAccent,
  registerNodeAccent, registerNodeSettings, registerNodeHelp, notifyGraphChanged,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { attachLineNumbers } from "../shared/line_numbers.mjs";

const CLASS = "PixaromaPromptEach";

// Default = minimum (node UI convention #5): a fresh drop is the smallest
// comfortable size and the user grows it. When default > min, dragging the
// corner inward visibly grows the node before clamping, which reads as a bug.
// Width is sized off the action row: 3 buttons at min-width 86 border-box + the
// 28px gear + 3 gaps of 4 + 16 of root padding is ~318, plus margin.
const DEFAULT_W = 340;
const DEFAULT_H = 250;
const MIN_W = 340;
const MIN_H = 250;
// Body content: field min (72) + gap (6) + action row (~24) + root padding (14).
const WIDGET_MIN_H = 118;

registerNodeHelp(CLASS, PROMPT_EACH_HELP);

// The settings live on the NODE INSTANCE, not on the node type: two Prompt Each
// nodes in one workflow can legitimately split differently. So this registers a
// custom panel rather than `rows` (which write ComfyUI settings, i.e. per-type
// defaults). ownMenuItem stops the central right-click entry doubling our own.
registerNodeSettings(CLASS, {
  title: "Prompt Each",
  ownMenuItem: true,
  open: (node) => openPanel(node),
});
registerNodeAccent(CLASS, { title: "Prompt Each" });

function openPanel(node) {
  if (isPanelOpenFor(node)) {
    closeSettingsPanelFor(node);
    return;
  }
  openSettingsPanel(node, () => refresh(node));
}

// Is the optional `text` input wired? Returns the mode that applies ("replace"
// or "add"), or null when nothing is connected.
function wiredState(node) {
  const slot = node?.inputs?.find((i) => i && i.name === "text");
  if (!slot || slot.link == null) return null;
  return readState(node).wiredMode;
}

// Re-render the face from current state. Cheap, and safe to call on the load
// path: it writes only DOM, never node.size / properties / slots (Vue Compat
// #18), so opening an untouched workflow cannot flag it modified.
function refresh(node) {
  const parts = node?._pixEachParts;
  if (!parts) return;
  const st = readState(node);
  const ws = wiredState(node);
  applyState(parts, st, ws);
  const result = buildPrompts(st.text, {
    split: st.split,
    expand: st.expand,
    trim: st.trim,
    skipEmpty: st.skipEmpty,
    cap: st.cap,
  });
  updateCount(parts, result, st.split, ws);
}

function flash(btn, label) {
  const original = btn.textContent;
  btn.textContent = label;
  btn.classList.add("is-flashing");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("is-flashing");
  }, 700);
}

function toast(text) {
  try {
    app.extensionManager?.toast?.add({ severity: "warn", detail: text, life: 2600 });
    return;
  } catch {}
  // Older Easy Install builds have no extensionManager.toast - Prompt Multi
  // carries the same fallback for the same reason.
  const d = document.createElement("div");
  d.textContent = text;
  d.style.cssText =
    "position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:2000;" +
    "background:#1d1d1d;color:#eee;border:1px solid #f66744;border-radius:6px;" +
    "padding:8px 14px;font:12px sans-serif;pointer-events:none;";
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

function wireEvents(node, parts) {
  const { ta, copyBtn, replaceBtn, clearBtn, gearBtn } = parts;

  ta.addEventListener("input", () => {
    if (ta.readOnly) return;
    const st = readState(node);
    st.text = ta.value;
    writeState(node, st);
    refresh(node);
  });
  // A DOM control commits on `click`/`input`, which is strictly AFTER the
  // mouseup ComfyUI snapshots on, so the change would never be recorded and the
  // user would silently lose it (convention #31). The pack-wide change net
  // covers clicks inside our own UI; typing needs saying explicitly.
  ta.addEventListener("change", () => notifyGraphChanged());

  copyBtn.addEventListener("click", async () => {
    const st = readState(node);
    if (!st.text.trim()) {
      toast("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(st.text);
      flash(copyBtn, "Copied");
    } catch {
      toast("Could not copy to the clipboard");
    }
  });

  replaceBtn.addEventListener("click", async () => {
    if (ta.readOnly) {
      toast("Text is wired in. Unplug it, or switch to Add in the settings.");
      return;
    }
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast("Could not paste from the clipboard");
      return;
    }
    // Chrome returns "" for both an empty clipboard and an image-only one, so
    // this single check covers both - and NOT wiping the box is the important
    // half: silently erasing somebody's list on a failed paste is unforgivable.
    if (!text) {
      toast("Nothing to paste");
      return;
    }
    const st = readState(node);
    st.text = text;
    writeState(node, st);
    refresh(node);
    notifyGraphChanged();
    flash(replaceBtn, "Pasted");
  });

  clearBtn.addEventListener("click", () => {
    if (ta.readOnly) {
      toast("Text is wired in. Unplug it, or switch to Add in the settings.");
      return;
    }
    const st = readState(node);
    st.text = "";
    writeState(node, st);
    refresh(node);
    notifyGraphChanged();
  });

  gearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPanel(node);
  });
}

app.registerExtension({
  name: "Pixaroma.PromptEach",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;

      // SYNCHRONOUS (node UI convention #9). configure() runs after
      // nodeCreated and restores the saved size, which is exactly what we want
      // for a reload or a duplicate; deferring this into the microtask below
      // would run it AFTER configure and clobber the restored size.
      if (node.size[0] < MIN_W) node.size[0] = DEFAULT_W;
      if (node.size[1] < MIN_H) node.size[1] = DEFAULT_H;

      // The DOM build stays deferred: nodeCreated fires BEFORE configure (Vue
      // Compat #8), so rendering now would show the default and flash to the
      // saved state a moment later.
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const parts = buildRoot();
        node._pixEachParts = parts;
        const root = parts.root;

        installCanvasZoomPassthrough(root); // convention #17
        installNativeTextMenu(root);        // right-click Paste in the box
        installNodeAccent(node, root);      // the face follows this node's accent

        const widget = node.addDOMWidget("prompteach", "pixaroma_prompteach", root, {
          serialize: false,
          getMinHeight: () => WIDGET_MIN_H,
        });
        applyAdaptiveCanvasOnly(widget);
        node._pixEachFloorOff = installResizeFloor(root, measureRootContent);

        // Must run AFTER the box is in the document - the gutter measures it.
        node._pixEachLnOff = attachLineNumbers(parts.ta, { minDigits: 2 });

        // MEASURED in both renderers: the same offset lands the pill on the
        // `total` row, clear of every slot label, so there is no branch here.
        // The July note saying Nodes 2.0 clips content above the widget top
        // was stale - the only clipping ancestors are the canvas container
        // and the app body, neither of which is inside the node.
        placeBand(parts, true);
        wireEvents(node, parts);
        refresh(node);
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      refresh(this);
      return r;
    };

    // Re-render when the text input is plugged or unplugged. This writes DOM
    // only - no node.properties, no size, no slots - so it needs no
    // isGraphLoading gate (Vue Compat #19 exempts runtime-only handlers).
    const origConnChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origConnChange ? origConnChange.apply(this, arguments) : undefined;
      refresh(this);
      return r;
    };

    // LEGACY ONLY. In Nodes 2.0 the rendered size lives in the Vue layout store,
    // not node.size, so clamping here desyncs the two and the node jumps to the
    // clamped size on a workflow switch.
    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    // Min-width self-heal, because onResize does not fire for every resize path
    // (Vue Compat #13). The isGraphLoading gate is NOT optional: node.size is
    // serialised and a draw hook runs on the very first frame of a load, so
    // ungated this is the one place that can rewrite the size of an untouched
    // workflow and flag it modified (convention #7).
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (isVueNodes() || isGraphLoading()) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSettingsPanelFor(this);
      this._pixEachFloorOff?.();
      this._pixEachFloorOff = null;
      // attachLineNumbers installs a ResizeObserver, and a Document holds its
      // observers strongly - without this the textarea, wrap, gutter and mirror
      // stay pinned for the rest of the session.
      this._pixEachLnOff?.();
      this._pixEachLnOff = null;
      this._pixEachParts = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// ---------------------------------------------------------------------------
// graphToPrompt: inject the state into the hidden PromptEachState input at
// submit time (Vue Compat #9).
//
// Subgraph-safe: ComfyUI flattens subgraph nodes into the prompt with composite
// ids ("5:12") that app.graph.getNodeById cannot resolve, so a plain lookup
// silently misses any node inside a subgraph and the state never arrives.
// ---------------------------------------------------------------------------
function buildNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findNode(index, promptId) {
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
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildNodeIndex();
        const node = findNode(index, key);
        if (!node) continue;
        const st = readState(node);
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptEachState = JSON.stringify({
          version: 1,
          text: st.text,
          split: st.split,
          expand: st.expand,
          trim: st.trim,
          skipEmpty: st.skipEmpty,
          cap: st.cap ?? DEFAULT_CAP,
          wiredMode: st.wiredMode,
        });
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptEach: graphToPrompt hook failed", err);
  }
  return result;
};
