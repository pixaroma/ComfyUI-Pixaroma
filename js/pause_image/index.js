import { app } from "/scripts/app.js";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { api } from "/scripts/api.js";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { getState, setGate, STATE_PROP } from "./state.mjs";
import { applyGateMode } from "./prune.mjs";
import {
  buildPauseWidget, renderPause, showFrame, frameViewUrl, NODE_MIN_W, NODE_MIN_H,
} from "./ui.mjs";

const CLASS = "PixaromaPauseImage";
const HIDDEN_INPUT = "PauseState";
const WIDGET_TYPE = "pixaroma_pause_ui";

// ── Queue a run with a one-shot submit mode the graphToPrompt hook reads ──
// "continue" -> prune the upstream (skip it), reload the snapshot downstream.
// "pause"    -> prune the downstream (stop at the gate), re-snapshot + preview.
async function queueWithMode(node, mode) {
  // Only THIS gate should carry a one-shot submit mode at submission time.
  // Clear any other gate's pending transient so a rapid double-click on two
  // different gates can't make both "continue" in the same prompt.
  const allNodes = app.graph?._nodes || app.graph?.nodes || [];
  for (const n of allNodes) {
    if (n !== node && n._pixPauseSubmitMode) n._pixPauseSubmitMode = null;
  }
  node._pixPauseSubmitMode = mode;
  node._pixPauseBusy = mode === "continue" ? "Continuing…" : "Regenerating…";
  renderPause(node);
  try {
    // Forward the normal Run signature (number, batchCount). app.queuePrompt
    // runs app.graphToPrompt internally, where our hook reads the transient.
    await app.queuePrompt(0, 1);
  } catch (err) {
    console.error("[Pause Image] queue failed", err);
  } finally {
    node._pixPauseSubmitMode = null;
    node._pixPauseBusy = null;
    renderPause(node);
  }
}

// Brief message in the status line, cleared after 2s (used by Copy / Open).
function flash(node, msg) {
  node._pixPauseFlash = msg;
  renderPause(node);
  clearTimeout(node._pixPauseFlashTimer);
  node._pixPauseFlashTimer = setTimeout(() => {
    node._pixPauseFlash = null;
    renderPause(node);
  }, 2000);
}

// Copy the previewed snapshot to the OS clipboard as PNG (one-click, like
// Preview Image Pixaroma - not ComfyUI's internal clipspace copy).
async function copySnapshot(node) {
  const frame = getState(node).frame;
  if (!frame?.filename) { flash(node, "Run once to capture an image"); return; }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    flash(node, "Clipboard not supported here");
    return;
  }
  try {
    const resp = await fetch(frameViewUrl(frame));
    if (!resp.ok) {
      flash(node, resp.status === 404 ? "Snapshot expired - run again" : "Copy failed");
      return;
    }
    const blob = await resp.blob();
    // Force image/png - some servers report image/x-png and ClipboardItem is strict.
    const png = blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    flash(node, "Copied to clipboard");
  } catch (err) {
    if (err?.name === "NotAllowedError") { flash(node, "Click the page, then Copy again"); return; }
    flash(node, "Copy failed");
  }
}

// Open the previewed snapshot in a new browser tab for full-screen viewing.
function openSnapshot(node) {
  const frame = getState(node).frame;
  if (!frame?.filename) { flash(node, "Run once to capture an image"); return; }
  // noopener so the new tab can't reach back into the ComfyUI window.
  const win = window.open(frameViewUrl(frame), "_blank", "noopener");
  if (!win) flash(node, "Popup blocked");
}

// ── Save (reuses the Preview Image server routes; no new backend) ──
const SAVE_PREFIX = "PauseImage";

// Fetch the previewed snapshot and return it as a PNG data URL. Throws
// "expired" if the temp file is gone (e.g. after a ComfyUI restart).
async function snapshotDataURL(node) {
  const frame = getState(node).frame;
  if (!frame?.filename) throw new Error("nosnap");
  const resp = await fetch(frameViewUrl(frame));
  if (!resp.ok) throw new Error(resp.status === 404 ? "expired" : "fetch");
  const blob = await resp.blob();
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("read"));
    r.readAsDataURL(blob);
  });
}

// Prefer the EXECUTION-time workflow captured when the snapshot was made (the
// exact seed that produced it), so the saved PNG drags back into ComfyUI as the
// same image. Fall back to the live graph if we have no captured metadata.
async function resolveSaveMeta(node) {
  const m = node._pixPauseExecMeta;
  if (m && m.workflow) return { workflow: m.workflow, prompt: m.prompt };
  const { workflow, output } = await app.graphToPrompt();
  return { workflow, prompt: output };
}

function saveErr(node, err) {
  if (err?.message === "expired") flash(node, "Snapshot expired - run again");
  else if (err?.message === "nosnap") flash(node, "Run once to capture an image");
  else flash(node, "Save failed");
}

// Save to ComfyUI's output/ folder (with the workflow embedded).
async function saveToOutput(node) {
  if (!node._pixPauseHasSnapshot) { flash(node, "Run once to capture an image"); return; }
  try {
    const image_b64 = await snapshotDataURL(node);
    const { workflow, prompt } = await resolveSaveMeta(node);
    const resp = await fetch("/pixaroma/api/preview/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64, filename_prefix: SAVE_PREFIX, workflow, prompt }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { flash(node, `Save failed: ${data.error || resp.status}`); return; }
    flash(node, `Saved: ${data.filename}`);
  } catch (err) { saveErr(node, err); }
}

// Save to a user-chosen folder via the OS "Save as" dialog (falls back to the
// browser Downloads folder when showSaveFilePicker isn't available).
async function saveToDisk(node) {
  if (!node._pixPauseHasSnapshot) { flash(node, "Run once to capture an image"); return; }
  let preparedBlob;
  let suggestedName = `${SAVE_PREFIX}.png`;
  try {
    const image_b64 = await snapshotDataURL(node);
    const { workflow, prompt } = await resolveSaveMeta(node);
    const resp = await fetch("/pixaroma/api/preview/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64, filename_prefix: SAVE_PREFIX, workflow, prompt }),
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      flash(node, `Save failed: ${e.error || resp.status}`);
      return;
    }
    const data = await resp.json();
    if (data.suggested_filename) suggestedName = data.suggested_filename;
    preparedBlob = await (await fetch(data.image_b64)).blob();
  } catch (err) { saveErr(node, err); return; }

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
      });
      const w = await handle.createWritable();
      await w.write(preparedBlob);
      await w.close();
      flash(node, `Saved: ${handle.name}`);
    } catch (err) {
      if (err?.name === "AbortError") return; // user cancelled, silent
      flash(node, "Save failed");
    }
    return;
  }
  // Fallback: <a download> to the browser Downloads folder.
  const url = URL.createObjectURL(preparedBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  flash(node, "Saved to Downloads");
}

function setupNode(node) {
  const root = buildPauseWidget(node, {
    onGate: (gate) => { setGate(node, gate); renderPause(node); },
    onContinue: () => queueWithMode(node, "continue"),
    onRegenerate: () => queueWithMode(node, "pause"),
    onCopy: () => copySnapshot(node),
    onSaveDisk: () => saveToDisk(node),
    onSaveOutput: () => saveToOutput(node),
    onOpen: () => openSnapshot(node),
  });
  installCanvasZoomPassthrough(root);
  const widget = node.addDOMWidget(WIDGET_TYPE, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => NODE_MIN_H,  // constant (Vue Compat #18)
  });
  // Adaptive canvasOnly: true in Classic (keeps it out of the Parameters tab),
  // false in Nodes 2.0 (so the Vue node body renders it).
  applyAdaptiveCanvasOnly(widget);

  // Nodes 2.0 only: a manual resize can drag the node SHORTER than its content
  // (getMinHeight isn't enforced on a manual drag there), which spills the
  // buttons/preview below the node frame. The root has overflow:hidden so it
  // never visibly spills; this observer also re-grows the node to fit whenever
  // the content gets clipped, so it can't be left broken. Gated on
  // !isGraphLoading so it never resizes on a workflow load (dirty-on-load).
  // Classic uses the onResize clamp + getMinHeight instead and doesn't spill.
  if (isVueNodes()) {
    const ro = new ResizeObserver(() => {
      if (isGraphLoading()) return;
      const over = root.scrollHeight - root.clientHeight;
      if (over > 1 && typeof node.setSize === "function") {
        node.setSize([node.size[0], node.size[1] + over]);
      }
    });
    ro.observe(root);
    node._pixPauseRO = ro;
  }

  // Fresh-node default size. configure() runs AFTER onNodeCreated and restores
  // the saved size for saved workflows, so this only affects fresh drops.
  if (!node.size || node.size[0] < NODE_MIN_W) node.size[0] = 400;
  if (!node.size || node.size[1] < NODE_MIN_H) node.size[1] = 400;

  // Defer the first render until node.properties is restored (Vue Compat #8).
  queueMicrotask(() => restore(node));
}

// DOM-only restore: re-render controls and re-load the last snapshot (if any).
// Never mutates serialized state, so it is safe on the load path (Vue Compat #18).
function restore(node) {
  renderPause(node);
  const s = getState(node);
  if (s.frame) showFrame(node, s.frame);  // onerror disables Continue if gone
}

app.registerExtension({
  name: "Pixaroma.PauseImage",

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

    // Self-heal minimum size. onResize is unreliable on the Vue frontend
    // (Vue Compat #13), so this is belt-and-braces; it only raises a too-small
    // size (saved sizes are >= min, so loads never mutate -> no dirty-on-load).
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < NODE_MIN_W) size[0] = NODE_MIN_W;
      if (size[1] < NODE_MIN_H) size[1] = NODE_MIN_H;
      return _resize?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      clearTimeout(this._pixPauseFlashTimer);
      this._pixPauseRO?.disconnect();
      this._pixPauseEls = null;
      return _removed?.apply(this, arguments);
    };
  },
});

// ── executed event: receive the snapshot preview frame from Python ──
api.addEventListener("executed", (e) => {
  const d = e.detail;
  const frames = d?.output?.pixaroma_pause_frame;
  if (!frames || !frames.length) return;
  // Node id may be a number (legacy) or string (Vue) - try both.
  let node = app.graph.getNodeById(d.node);
  if (!node && typeof d.node === "string") node = app.graph.getNodeById(parseInt(d.node, 10));
  if (!node || node.comfyClass !== CLASS) return;
  const f = frames[0];
  // Capture the execution-time workflow for the Save buttons (runtime-only -
  // never persisted to node.properties, it would bloat the saved workflow).
  // Only present on a fresh pause/pass capture, so it stays the generation
  // workflow even after a Continue (whose frame carries no meta).
  if (f._pixaroma_meta) node._pixPauseExecMeta = f._pixaroma_meta;
  const s = getState(node);
  s.frame = { filename: f.filename, subfolder: f.subfolder || "", type: f.type || "temp" };
  showFrame(node, s.frame);
});

// ── app.graphToPrompt hook: prune + inject mode (Pattern #9, Switch-style) ──
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

// isOutput(classType): true iff a class_type is an OUTPUT_NODE (Save / Preview /
// another gate). Read from the live node defs the frontend already holds
// (registered_node_types[class_type].nodeData.output_node - the same accessor
// pixgroup + xy_plot use). Every node that can appear in a prompt is registered,
// so this resolves for all real nodes; if the registry is somehow missing we
// return null so the prune falls back to the old delete-everything behavior.
function makeIsOutput() {
  const reg = window.LiteGraph?.registered_node_types;
  if (!reg) return null;
  return (classType) => !!(classType && reg[classType]?.nodeData?.output_node);
}

// Process order: a CONTINUE gate prunes the prompt down to its own downstream
// branch, which removes any gate that sits UPSTREAM of it. So continue must run
// BEFORE pause/pass - otherwise an upstream gate still on Pause would delete the
// continued gate's branch first and the run would stop at the wrong gate (the
// chained-Pause bug: Continue on a later gate did nothing because an earlier
// gate pruned it away).
const MODE_RANK = { continue: 0, pause: 1, pass: 2 };

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    // Gather every Pause Image entry + its effective mode first.
    let index = null;
    const isOutput = makeIsOutput();
    const gates = [];
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== CLASS) continue;
      if (!index) index = buildNodeIndex();
      const node = findNode(index, id);
      // Effective mode: a one-shot button override (Continue/Regenerate) wins,
      // otherwise the persistent toggle (Pause default, or Pass). If the live
      // node can't be resolved (rare - a subgraph id edge case), default to the
      // harmless "pass" (no prune) rather than the destructive "pause" (which
      // would silently truncate a workflow we couldn't positively identify).
      const submit = node?._pixPauseSubmitMode;
      let mode;
      if (submit === "continue" || submit === "pause") {
        mode = submit;
      } else if (node) {
        mode = node.properties?.[STATE_PROP]?.gate === "pass" ? "pass" : "pause";
      } else {
        mode = "pass";
      }
      gates.push({ id, entry, mode });
    }
    gates.sort((a, b) => MODE_RANK[a.mode] - MODE_RANK[b.mode]);
    for (const g of gates) {
      if (!out[g.id]) continue;  // already pruned away by an earlier continue gate
      applyGateMode(out, g.id, g.entry, g.mode, isOutput, HIDDEN_INPUT);
    }
  }
  return result;
};
