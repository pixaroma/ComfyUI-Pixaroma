import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import {
  getState, setGate, setText, setModelText, revertText, STATE_PROP,
} from "./state.mjs";
import { applyGateMode } from "./prune.mjs";
import {
  buildPauseTextWidget, renderPause, syncText, flashIcon, statusText, NODE_MIN_W, NODE_MIN_H, nodeMinH,
} from "./ui.mjs";

const CLASS = "PixaromaPauseText";
const HIDDEN_INPUT = "PauseState";
const WIDGET_TYPE = "pixaroma_pause_text_ui";

// ── Place the status band in the slot dead-space (between the input/output dots) ──
// Classic: FLOAT the band up out of flow into the slot row (the widget wrapper is
// overflow:visible, so content above the widget top isn't clipped - LoRA Loader
// technique). Nodes 2.0: the body is clipped above its top, so instead NUDGE the
// slot block out of flow so the band (in-flow first child) rises onto the slot row
// (Load Image Mini technique). Cosmetic + wrapped in try/catch: on any failure the
// band degrades to a normal row and the node still works. Writes only DOM style,
// so it can never dirty a saved workflow.
const CLASSIC_BOX_LIFT = -18;   // pull the box up into the slot reserve (no top gap)
const CLASSIC_STATUS_Y = 14;    // node-local Y of the slot row (where the status paints)
const CLASSIC_STATUS_RSV = 62;  // clear the "text" dot labels on each side
const NUDGE_EXTRA_LIFT = 6;

function slotBlock(el) {
  const s = el.querySelector(".lg-slot--output") || el.querySelector(".lg-slot--input");
  return s?.parentElement?.parentElement || null;
}

// Classic: paint the status text on the canvas in the slot row (between the dots).
// Painting is fully clipped to the node width by us, so - unlike a floated DOM
// band - it can NEVER overflow past the node edge on resize. Nodes 2.0 skips this
// (onDrawForeground isn't called there) and uses the DOM band + nudge instead.
function paintStatus(node, ctx) {
  if (isVueNodes() || node.flags?.collapsed) return;
  const txt = statusText(node);
  if (!txt) return;
  const avail = node.size[0] - CLASSIC_STATUS_RSV * 2;
  if (avail < 24) return;                       // too narrow to show anything
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let s = txt;
  if (ctx.measureText(s).width > avail) {        // truncate with an ellipsis
    while (s.length > 1 && ctx.measureText(s + "…").width > avail) s = s.slice(0, -1);
    s += "…";
  }
  ctx.fillText(s, node.size[0] / 2, CLASSIC_STATUS_Y);
  ctx.restore();
}

// Place the DOM band. Classic: HIDE it (the status is canvas-painted) and pull the
// box up to close the slot-reserve gap. Nodes 2.0: SHOW the in-flow band and nudge
// the slot block so it overlaps the slot row. Writes only DOM style + one canvas
// margin - never node.size/props/slots - so it can't dirty a saved workflow.
function positionBand(node) {
  const band = node._pixPtEls?.band;
  const root = node._pixPtEls?.root;
  const box = node._pixPtEls?.box;
  if (!band || !root || !box) return;
  try {
    if (isVueNodes()) {
      root.style.overflow = "";               // CSS default (hidden) - Vue spill safety
      band.style.display = "";
      box.style.marginTop = "";               // the nudge already tucks the box up
      const el = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
      if (!el) return;
      const block = slotBlock(el);
      const col = (el.querySelector(".lg-slot--output") || el.querySelector(".lg-slot--input"))?.parentElement;
      if (!block) return;
      if (parseFloat(block.style.marginBottom || "0") < 0) return;  // already nudged
      block.style.marginBottom = "0px";
      const h = block.offsetHeight;
      if (h <= 0) return;
      block.style.marginBottom = (-(h + NUDGE_EXTRA_LIFT)) + "px";
      block.style.pointerEvents = "none";   // dots stay draggable via the col below
      if (col) col.style.pointerEvents = "auto";
    } else {
      // Classic: hide the DOM band (status is painted), pull the box up to close the
      // top gap. overflow:visible lets the lifted box show; it's node-width so it
      // never overflows sideways, and the onResize clamp stops downward spill.
      band.style.display = "none";
      root.style.overflow = "visible";
      box.style.marginTop = CLASSIC_BOX_LIFT + "px";
    }
  } catch { /* degrade to a plain row */ }
}

// Vue REPLACES the node element on re-render (orphaning the nudge) and can add
// slots a frame late, so a self-heal poll is required. Classic sets the float once
// (it persists on our own element).
function watchBand(node) {
  positionBand(node);
  requestAnimationFrame(() => positionBand(node));
  setTimeout(() => positionBand(node), 120);
  if (isVueNodes() && !node._pixPtBandPoll) {
    node._pixPtBandPoll = setInterval(() => {
      if (!node.graph) { clearInterval(node._pixPtBandPoll); node._pixPtBandPoll = null; return; }
      positionBand(node);
    }, 350);
  }
}

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
    // Per-renderer constant (Vue Compat #18): Classic excludes the floated band,
    // Nodes 2.0 includes the in-flow band. Constant per renderer -> no jitter.
    getMinHeight: () => nodeMinH(isVueNodes()),
  });
  applyAdaptiveCanvasOnly(widget);

  // Pin a content floor WHILE a resize handle is dragged (Nodes 2.0; a no-op in
  // Classic, which floors via getMinHeight + the onResize clamp). Stops the node
  // being dragged so short the button row spills below the frame - the ONLY Vue
  // floor we use (NOT a ResizeObserver setSize re-grow: that can fire mid-drag and
  // desync Align, per CLAUDE.md). Only present during the drag, so it never
  // inflates node.size on load (no dirty-on-load). Verified: arms at 214px.
  node._pixPtFloorOff = installResizeFloor(root, () => nodeMinH(isVueNodes()), () => {
    // Nodes 2.0 has no live width clamp (it ignores min-width / computeLayoutSize),
    // so snap the width back to the min AFTER a resize that ended too narrow -
    // deferred a tick so it runs after the frontend finalizes the drag. Classic is
    // already clamped live in onResize, so this is a no-op there.
    if (!isVueNodes()) return;
    setTimeout(() => {
      if (node.graph && node.size[0] < NODE_MIN_W && typeof node.setSize === "function") {
        node.setSize([NODE_MIN_W, node.size[1]]);
      }
    }, 0);
  });

  // Fresh-node default size - opens big (like Text Join Four) since it usually
  // holds a paragraph of prompt. Use setSize (NOT a raw node.size write) so the DOM
  // widget WIDTH actually propagates - a fresh node arrives at ~MIN_W, and a raw
  // width write doesn't reach the rendered widget (it stayed narrow, truncating the
  // band). Set unconditionally: configure() runs AFTER onNodeCreated and restores a
  // saved size for existing nodes, so this only sticks for fresh drops; the min
  // stays small (onResize) so users can still shrink it.
  if (typeof node.setSize === "function") node.setSize([480, 520]);
  else { node.size[0] = 480; node.size[1] = 520; }

  watchBand(node);  // float (Classic) / nudge (Vue) the status band into the slot row

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
      // LEGACY ONLY. In Nodes 2.0 the rendered size lives in the Vue layout store,
      // not node.size - clamping node.size there desyncs (Vue renders the dragged
      // size while node.size holds the clamped value, so content spills). Vue's
      // floor comes from installResizeFloor + the ResizeObserver re-grow instead.
      if (!isVueNodes()) {
        const minH = nodeMinH(false);
        if (size[0] < NODE_MIN_W) size[0] = NODE_MIN_W;
        if (size[1] < minH) size[1] = minH;
      }
      return _resize?.apply(this, arguments);
    };

    // Classic: paint the status text in the slot row (Nodes 2.0 skips it - this
    // hook isn't called there, and the DOM band handles it).
    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _draw?.apply(this, arguments);
      paintStatus(this, ctx);
      return r;
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      clearTimeout(this._pixPtFlashTimer);
      if (this._pixPtBandPoll) { clearInterval(this._pixPtBandPoll); this._pixPtBandPoll = null; }
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
        // A plain Run: the toggle decides. Keep behaves like Continue on EVERY run
        // (skip the model, reuse the current text, let the downstream make a fresh
        // image) - it's Continue turned into a persistent mode.
        const g = node.properties?.[STATE_PROP]?.gate;
        mode = g === "pass" ? "pass" : g === "keep" ? "continue" : "pause";
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
