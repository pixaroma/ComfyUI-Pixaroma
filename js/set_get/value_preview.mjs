// ╔═══════════════════════════════════════════════════════════════╗
// ║  Set / Get Pixaroma - best-effort value readout               ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// A tiny, SUBTLE "= 81" line, display-only (never serialized), shown only when
// the node is EXPANDED and the wired value is a simple type (INT / FLOAT /
// STRING / BOOLEAN). Image / latent / model / conditioning show nothing.
//
// The value is read best-effort from the upstream source widget (e.g. a Number
// node feeding the Set). If the source is computed (a math node, a sampler,
// etc.) there is no frontend-knowable value, so we show nothing. A light poll
// keeps it live when the user edits the upstream number.
//
// One DOM widget per node (adaptive canvasOnly so it renders in both Classic and
// Nodes 2.0). It collapses to zero height when there is nothing to show.

import { app } from "/scripts/app.js";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";
import { SET_TYPE, GET_TYPE, getLink, findSetterByName } from "./scope.mjs";

const SIMPLE_TYPES = new Set(["INT", "FLOAT", "NUMBER", "STRING", "BOOLEAN", "BOOL"]);
const CSS_ID = "pix-setget-css";
const ROW_H = 18;

export function isSimpleType(t) {
  return typeof t === "string" && SIMPLE_TYPES.has(t.toUpperCase());
}

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const el = document.createElement("style");
  el.id = CSS_ID;
  // Semi-transparent white so it adapts if the user recolors the node body
  // (CLAUDE.md UI convention #1). Mono digits, single line, never wraps.
  el.textContent = `
    .pix-sg-val {
      box-sizing: border-box;
      width: 100%;
      height: ${ROW_H}px;
      line-height: ${ROW_H}px;
      padding: 0 8px;
      font: 11px/${ROW_H}px monospace;
      color: rgba(255, 255, 255, 0.55);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: none;
      pointer-events: none;
    }
  `;
  document.head.appendChild(el);
}

function fmt(v, type) {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!isFinite(v)) return String(v);
    if (Number.isInteger(v)) return String(v);
    return String(+v.toFixed(4));
  }
  let s = String(v).replace(/\s+/g, " ").trim();
  if (s === "") return null;
  if (s.length > 28) s = s.slice(0, 27) + "…";
  return s;
}

// Best-effort read of a primitive value from a source node's widgets.
function readPrimitiveWidget(node, type) {
  if (!node || !Array.isArray(node.widgets)) return null;
  const T = String(type).toUpperCase();
  const wantNum = /INT|FLOAT|NUMBER/.test(T);
  const wantBool = /BOOL/.test(T);
  for (const w of node.widgets) {
    if (!w || w.hidden) continue;
    const name = (w.name || "").toLowerCase();
    if (name === "control_after_generate") continue;
    const val = w.value;
    if (wantBool && typeof val === "boolean") return val;
    if (wantNum && typeof val === "number") return val;
    if (wantNum && typeof val === "string" && val.trim() !== "" && !isNaN(+val)) return +val;
    if (!wantNum && !wantBool && typeof val === "string") return val;
  }
  const first = node.widgets[0]?.value;
  return first != null && typeof first !== "object" ? first : null;
}

// Follow virtual reroute-like nodes (Reroute, our own Get) up to a real source.
function resolveRealSource(graph, node, slot, depth) {
  if (!node || depth > 8) return null;
  if (node.type === GET_TYPE) {
    const setter = findSetterByName(node.graph || graph, node.widgets?.[0]?.value);
    return setter ? setSourceOf(setter.node) : null;
  }
  if (node.isVirtualNode && typeof node.getInputLink === "function") {
    const l = node.getInputLink(slot);
    if (!l || l.origin_id == null) return null;
    const g = node.graph || graph;
    return resolveRealSource(g, g.getNodeById(l.origin_id), l.origin_slot, depth + 1);
  }
  return { graph: node.graph || graph, node, slot };
}

// {graph, node, slot} feeding a Set node's input (resolving virtuals), or null.
function setSourceOf(setNode) {
  const g = setNode?.graph;
  const input = setNode?.inputs?.[0];
  if (!g || !input || input.link == null) return null;
  const link = getLink(g, input.link);
  if (!link) return null;
  return resolveRealSource(g, g.getNodeById(link.origin_id), link.origin_slot, 0);
}

// Value string for a Set node (null if not a simple type / not derivable).
export function deriveSetValue(setNode) {
  const type = setNode?.inputs?.[0]?.type;
  if (!isSimpleType(type) || setNode.inputs[0].link == null) return null;
  const src = setSourceOf(setNode);
  if (!src) return null;
  return fmt(readPrimitiveWidget(src.node, type), type);
}

// Value string for a Get node via its resolved setter.
export function deriveGetValue(getNode) {
  const name = getNode?.widgets?.[0]?.value;
  if (!name) return null;
  const setter = findSetterByName(getNode.graph, name);
  return setter ? deriveSetValue(setter.node) : null;
}

// Create the (always-present, height-toggling) readout widget once. Called from
// onAdded (node is in the graph by then, so addDOMWidget is reliable) and
// failure-tolerant so a DOM hiccup can never block node creation.
export function ensureValueWidget(node) {
  if (node._pixSgValEl) return node._pixSgValEl;
  try {
    injectCSS();
    const el = document.createElement("div");
    el.className = "pix-sg-val";
    el.style.display = "none";
    const w = node.addDOMWidget("pix_setget_value", "pixaroma_setget_value", el, {
      serialize: false,
      getMinHeight: () => (node._pixSgValShown ? ROW_H : 0),
      getMaxHeight: () => (node._pixSgValShown ? ROW_H : 0),
    });
    // Drives the legacy (canvas) layout; 0 height when hidden so it reserves
    // nothing on a name-only node.
    w.computeSize = () => [node.size?.[0] || 140, node._pixSgValShown ? ROW_H : 0];
    applyAdaptiveCanvasOnly(w);
    node._pixSgValEl = el;
    node._pixSgValWidget = w;
    return el;
  } catch {
    return null;
  }
}

// Recompute + repaint the readout for one node. Cheap; safe to call often.
export function refreshValue(node) {
  const el = node._pixSgValEl;
  if (!el) return;
  let val = null;
  try {
    val = node.type === SET_TYPE ? deriveSetValue(node) : deriveGetValue(node);
  } catch {
    val = null;
  }
  const show = val != null && val !== "";
  const prevShown = !!node._pixSgValShown;
  const prevVal = el.dataset.v ?? "";
  if (show && val !== prevVal) el.textContent = "= " + val;
  node._pixSgValShown = show;
  el.dataset.v = show ? val : "";
  el.style.display = show ? "block" : "none";
  if (show !== prevShown || (show && val !== prevVal)) {
    node.setDirtyCanvas?.(true, true);
  }
}

// Single shared poll: keeps readouts live when the user edits an upstream
// number. Only touches expanded Set/Get nodes that already have a readout, in
// the currently-viewed graph, and only repaints on a real change.
let _poll = null;
export function startValuePoll() {
  if (_poll) return;
  _poll = setInterval(() => {
    const g = app.canvas?.graph || app.graph;
    if (!g?._nodes) return;
    for (const n of g._nodes) {
      if ((n.type === SET_TYPE || n.type === GET_TYPE) && !n.flags?.collapsed && n._pixSgValEl) {
        refreshValue(n);
      }
    }
  }, 450);
}
