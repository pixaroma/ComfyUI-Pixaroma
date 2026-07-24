import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import {
  getState, setGate, setText, setModelText, revertText, STATE_PROP,
} from "./state.mjs";
import { applyGateMode } from "./prune.mjs";
import {
  buildPauseTextWidget, renderPause, syncText, flashIcon, NODE_MIN_W, NODE_MIN_H,
} from "./ui.mjs";

const CLASS = "PixaromaPauseText";
const HIDDEN_INPUT = "PauseState";
const WIDGET_TYPE = "pixaroma_pause_text_ui";

// ── Queue a run with a one-shot submit mode the graphToPrompt hook reads ──
// "continue" -> prune the upstream, output the edited text downstream.
// "pause"    -> prune the downstream (stop at the gate), re-capture the model text.
async function queueWithMode(node, mode) {
  // Only THIS gate carries a one-shot submit mode at submission time.
  const allNodes = app.graph?._nodes || app.graph?.nodes || [];
  for (const n of allNodes) {
    if (n !== node && n._pixPtSubmitMode) n._pixPtSubmitMode = null;
  }
  node._pixPtSubmitMode = mode;
  node._pixPtBusy = mode === "continue" ? "Continuing…" : "Regenerating…";
  renderPause(node);
  try {
    await app.queuePrompt(0, 1);
  } catch (err) {
    console.error("[Pause Text] queue failed", err);
  } finally {
    node._pixPtSubmitMode = null;
    node._pixPtBusy = null;
    renderPause(node);
  }
}

// Brief status message, cleared after 2.5s (Copy / no-seed feedback).
function flash(node, msg) {
  node._pixPtFlash = msg;
  renderPause(node);
  clearTimeout(node._pixPtFlashTimer);
  node._pixPtFlashTimer = setTimeout(() => {
    node._pixPtFlash = null;
    renderPause(node);
  }, 2500);
}

// ── Regenerate: roll upstream seed(s), then re-run in Pause mode ──
function getLink(graph, linkId) {
  if (linkId == null) return null;
  let link = graph.links?.[linkId];
  if (!link && typeof graph.links?.get === "function") link = graph.links.get(linkId);
  return link;
}

// A numeric widget whose name mentions "seed" (skips the string "control_after_
// generate" combo, whose value is not a number).
function isSeedWidget(w) {
  return !!(w && typeof w.name === "string" && /seed/i.test(w.name) && typeof w.value === "number");
}

function setRandomSeed(node, w) {
  let max = 0xffffffff;
  if (w.options && Number.isFinite(w.options.max)) max = Math.min(w.options.max, Number.MAX_SAFE_INTEGER);
  let min = 0;
  if (w.options && Number.isFinite(w.options.min)) min = w.options.min;
  const span = Math.max(1, Math.min(max - min, 0xffffffff));
  const val = Math.floor(min + Math.random() * span);
  w.value = val;
  try { w.callback?.(val, app.canvas, node); } catch { /* ignore */ }
}

// Walk the live graph backward from this node's `text` input and randomize every
// seed widget found (bounded by a visited set + depth cap). Returns how many
// seeds were rolled, so the caller can tell the user when there were none.
function randomizeUpstreamSeeds(node) {
  const graph = node.graph;
  if (!graph) return 0;
  const seen = new Set();
  const stack = [];
  const MAX_DEPTH = 50;
  for (const inp of node.inputs || []) {
    if (inp.name !== "text" || inp.link == null) continue;
    const l = getLink(graph, inp.link);
    if (l && l.origin_id != null) stack.push({ id: l.origin_id, depth: 0 });
  }
  let count = 0;
  while (stack.length) {
    const { id, depth } = stack.pop();
    const key = String(id);
    if (seen.has(key) || depth > MAX_DEPTH) continue;
    seen.add(key);
    const n = graph.getNodeById(id);
    if (!n) continue;
    for (const w of n.widgets || []) {
      if (isSeedWidget(w)) { setRandomSeed(n, w); count++; }
    }
    for (const ni of n.inputs || []) {
      if (ni.link == null) continue;
      const l = getLink(graph, ni.link);
      if (l && l.origin_id != null) stack.push({ id: l.origin_id, depth: depth + 1 });
    }
  }
  if (count) graph.setDirtyCanvas?.(true, true);
  return count;
}

async function regenerate(node) {
  const rolled = randomizeUpstreamSeeds(node);
  if (!rolled) flash(node, "No seed found upstream - text may be unchanged");
  await queueWithMode(node, "pause");
}

// Copy the box text to the OS clipboard.
async function copyText(node) {
  const txt = getState(node).text || "";
  if (!txt) { flash(node, "Nothing to copy"); return; }
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(txt);
    flashIcon(node._pixPtEls?.copyBtn);
    flash(node, "Copied to clipboard");
  } catch {
    flash(node, "Could not copy to clipboard");
  }
}

function setupNode(node) {
  const root = buildPauseTextWidget(node, {
    onGate: (gate) => { setGate(node, gate); renderPause(node); },
    onInput: (val) => { setText(node, val); renderPause(node); },
    onContinue: () => queueWithMode(node, "continue"),
    onRegenerate: () => regenerate(node),
    onCopy: () => copyText(node),
    onRevert: () => { revertText(node); syncText(node); renderPause(node); flashIcon(node._pixPtEls?.revertBtn); },
  });
  const widget = node.addDOMWidget(WIDGET_TYPE, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => NODE_MIN_H,  // constant (Vue Compat #18)
  });
  applyAdaptiveCanvasOnly(widget);

  // Pin a content floor WHILE a resize handle is dragged (both renderers; self-
  // gates to real DOM resize drags, so it's a no-op in Classic). Stops the node
  // being dragged so short the text box collapses out of the frame. Only present
  // during the drag, so it never inflates node.size on load (no dirty-on-load).
  node._pixPtFloorOff = installResizeFloor(root, () => NODE_MIN_H);

  // Nodes 2.0 only: a manual resize can drag the node shorter than getMinHeight
  // (not enforced on a manual drag there), spilling the box below the frame. The
  // root has overflow:hidden so it never visibly spills; this observer re-grows
  // the node to fit if clipped. Gated on !isGraphLoading so it never resizes on
  // a workflow load (dirty-on-load). Classic uses the onResize clamp instead.
  if (isVueNodes()) {
    const ro = new ResizeObserver(() => {
      if (isGraphLoading()) return;
      const over = root.scrollHeight - root.clientHeight;
      if (over > 1 && typeof node.setSize === "function") {
        node.setSize([node.size[0], node.size[1] + over]);
      }
    });
    ro.observe(root);
    node._pixPtRO = ro;
  }

  // Fresh-node default size (wide enough to read a paragraph of prompt without
  // wrapping every few words). configure() runs AFTER onNodeCreated and restores
  // a saved size, so this only affects fresh drops.
  if (!node.size || node.size[0] < NODE_MIN_W) node.size[0] = 480;
  if (!node.size || node.size[1] < NODE_MIN_H) node.size[1] = 380;

  // Defer the first render until node.properties is restored (Vue Compat #8).
  queueMicrotask(() => restore(node));
}

// DOM-only restore: re-render controls + push the stored text into the box.
// Never mutates serialized state, so it is safe on the load path (Vue Compat #18).
function restore(node) {
  renderPause(node);
  syncText(node);
}

app.registerExtension({
  name: "Pixaroma.PauseText",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      setupNode(this);
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      restore(this);
      return r;
    };

    // Self-heal minimum size (belt-and-braces with getMinHeight; onResize is
    // unreliable on the Vue frontend - Vue Compat #13). Only raises a too-small
    // size, so saved (>= min) sizes never mutate -> no dirty-on-load.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < NODE_MIN_W) size[0] = NODE_MIN_W;
      if (size[1] < NODE_MIN_H) size[1] = NODE_MIN_H;
      return _resize?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      clearTimeout(this._pixPtFlashTimer);
      this._pixPtRO?.disconnect();
      try { this._pixPtFloorOff?.(); } catch { /* ignore */ }
      this._pixPtFloorOff = null;
      this._pixPtEls = null;
      return _removed?.apply(this, arguments);
    };
  },
});

// ── executed event: receive the model's text from Python, fill the box ──
// Python emits pixaroma_pause_text ONLY on a wired Pause/Pass (a fresh model
// capture), so receiving it always means "replace the box with fresh text".
api.addEventListener("executed", (e) => {
  const d = e.detail;
  const payload = d?.output?.pixaroma_pause_text;
  if (!payload || !payload.length) return;
  let node = app.graph.getNodeById(d.node);
  if (!node && typeof d.node === "string") node = app.graph.getNodeById(parseInt(d.node, 10));
  if (!node || node.comfyClass !== CLASS) return;
  const text = typeof payload[0] === "string" ? payload[0] : String(payload[0] ?? "");
  setModelText(node, text);   // replace box + revert baseline
  syncText(node);
  renderPause(node);
});

// ── app.graphToPrompt hook: prune + inject mode/text (Pattern #9) ──
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

// isOutput(classType): true iff a class_type is an OUTPUT_NODE. Read from the
// live node defs (same accessor pixgroup + xy_plot use). Missing registry -> null
// -> applyGateMode falls back to delete-everything (safe: upstream still skipped).
function makeIsOutput() {
  const reg = window.LiteGraph?.registered_node_types;
  if (!reg) return null;
  return (classType) => !!(classType && reg[classType]?.nodeData?.output_node);
}

// The current edited box text: the live textarea if present, else stored state.
function editedTextOf(node) {
  const live = node._pixPtEls?.ta?.value;
  if (typeof live === "string") return live;
  return getState(node).text;
}

// CONTINUE gates prune down to their own downstream branch, which can delete a
// gate that sits UPSTREAM of them - so continue must run BEFORE pause/pass.
const MODE_RANK = { continue: 0, pause: 1, pass: 2 };

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    const isOutput = makeIsOutput();
    const gates = [];
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== CLASS) continue;
      if (!index) index = buildNodeIndex();
      const node = findNode(index, id);
      const submit = node?._pixPtSubmitMode;
      let mode;
      if (submit === "continue" || submit === "pause") {
        mode = submit;
      } else if (node) {
        mode = node.properties?.[STATE_PROP]?.gate === "pass" ? "pass" : "pause";
      } else {
        // Can't resolve the live node: default to the harmless "pass" (no prune)
        // rather than the destructive "pause" (which truncates the workflow).
        mode = "pass";
      }
      const editedText = node ? editedTextOf(node) : "";
      gates.push({ id, entry, mode, editedText });
    }
    gates.sort((a, b) => MODE_RANK[a.mode] - MODE_RANK[b.mode]);
    for (const g of gates) {
      if (!out[g.id]) continue;  // already pruned by an earlier continue gate
      applyGateMode(out, g.id, g.entry, g.mode, isOutput, HIDDEN_INPUT, {
        inputKey: "text",
        editedText: g.editedText,
      });
    }
  }
  return result;
};
