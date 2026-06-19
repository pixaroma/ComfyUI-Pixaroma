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
// Rendering is per-renderer so the line sits tight under the name field:
//   - Classic (LiteGraph): PAINTED in onDrawForeground at the bottom of the
//     node body (node grows by one row when shown). Gives exact positioning.
//   - Nodes 2.0 (Vue): a DOM element row (the grid lays it out tightly).

import { app } from "/scripts/app.js";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { SET_TYPE, GET_TYPE, getLink, findSetterByName } from "./scope.mjs";

const SIMPLE_TYPES = new Set(["INT", "FLOAT", "NUMBER", "STRING", "BOOLEAN", "BOOL"]);
const CSS_ID = "pix-setget-css";
const ROW_H = 18;

function isVue() {
  return !!window.LiteGraph?.vueNodesMode;
}

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

// Round half to even, matching Python's round() (and Number Pixaroma's int
// output), so an INT-typed preview reads the same as the real value.
function bankersRound(v) {
  if (Math.abs(v - Math.trunc(v)) === 0.5) {
    const f = Math.floor(v);
    return f % 2 === 0 ? f : f + 1;
  }
  return Math.round(v);
}

function fmt(v, type) {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!isFinite(v)) return null; // hide the line for NaN / Infinity
    // An INT-typed slot emits a whole number even when the source widget holds
    // a decimal (e.g. Number Pixaroma 5.5 -> its int output is 6), so round.
    if (String(type).toUpperCase() === "INT") return String(bankersRound(v));
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
  // No widget matched the wanted kind. For numeric / boolean slots do NOT fall
  // back to an unrelated widget: a math node's formula text "a + b" is not its
  // computed value (7), so showing it would mislead. Only STRING falls back to
  // the first text widget.
  if (!wantNum && !wantBool) {
    const first = node.widgets[0]?.value;
    return typeof first === "string" ? first : null;
  }
  return null;
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

// Nodes 2.0 only: create the DOM element row once (the Vue grid lays it out
// tightly under the name). Classic paints instead, so it makes no DOM widget.
// Failure-tolerant so a DOM hiccup can never block node creation.
export function ensureValueWidget(node) {
  if (!isVue()) return null;
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
    w.computeSize = () => [node.size?.[0] || 140, node._pixSgValShown ? ROW_H : 0];
    applyAdaptiveCanvasOnly(w);
    node._pixSgValEl = el;
    node._pixSgValWidget = w;
    return el;
  } catch {
    return null;
  }
}

// Classic only: paint "= value" right under the NAME FIELD. We anchor to the
// name widget's actual drawn position (widget.last_y), NOT the node bottom,
// because the node's minimum height leaves slack below the last widget and
// anchoring to the bottom floated the line low. Vue uses the DOM element.
// Called from each node's onDrawForeground (draw time, so last_y is set).
export function paintReadout(node, ctx) {
  if (isVue() || node.flags?.collapsed) return;
  if (!node._pixSgValShown || !node._pixSgValText || !ctx) return;
  const w = node.size?.[0] || 0;
  if (w <= 0) return;

  // Bottom of the last widget (the name field) in body coordinates.
  const NW_H = window.LiteGraph?.NODE_WIDGET_HEIGHT || 20;
  let anchor = 0;
  for (const wd of node.widgets || []) {
    if (typeof wd.last_y !== "number") continue;
    let h = NW_H;
    try {
      h = wd.computeSize?.(w)?.[1] || NW_H;
    } catch {
      /* ignore */
    }
    anchor = Math.max(anchor, wd.last_y + h);
  }
  // No widget drawn yet (first frame after add) -> skip; we paint next frame
  // once last_y is set, rather than guess a position from the node bottom.
  if (anchor <= 0) return;

  // Grow the node just enough to enclose the line right under the name
  // (converges in one frame; never resize mid-load -> Vue Compat #18).
  const needed = anchor + ROW_H;
  if ((node.size?.[1] || 0) < needed) {
    let loading = false;
    try {
      loading = isGraphLoading();
    } catch {
      /* ignore */
    }
    if (!loading) node.setSize?.([node.size[0], needed]);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, anchor, w, ROW_H); // clip so a long value never spills sideways
  ctx.clip();
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("= " + node._pixSgValText, 12, anchor + 13);
  ctx.restore();
}

// Classic only: when the readout is HIDDEN, shrink the node back to its content
// (drop the row the painted line used). When SHOWN, paintReadout sizes the node
// to the real name-field anchor during draw, so nothing to do here. Vue's grid
// handles its own height. Never resize during a load (Vue Compat #18).
function fitNodeForReadout(node) {
  if (isVue() || node._pixSgValShown) return;
  try {
    if (isGraphLoading()) return;
  } catch {
    /* ignore */
  }
  const base = node.computeSize?.();
  if (base) node.setSize?.([node.size?.[0] || base[0], base[1]]);
}

// Recompute the readout for one node. Cheap; safe to call often.
export function refreshValue(node) {
  let val = null;
  try {
    val = node.type === SET_TYPE ? deriveSetValue(node) : deriveGetValue(node);
  } catch {
    val = null;
  }
  const show = val != null && val !== "";
  const prevShown = !!node._pixSgValShown;
  const prevText = node._pixSgValText || "";
  node._pixSgValShown = show;
  node._pixSgValText = show ? val : "";

  // Nodes 2.0: update the DOM element (created only in Vue mode).
  const el = node._pixSgValEl;
  if (el) {
    if (show && val !== prevText) el.textContent = "= " + val;
    el.style.display = show ? "block" : "none";
  }

  if (show !== prevShown) fitNodeForReadout(node);
  if (show !== prevShown || val !== prevText) node.setDirtyCanvas?.(true, true);
}

// Single shared poll: keeps readouts live when the user edits an upstream
// number. Only touches expanded Set/Get nodes in the currently-viewed graph,
// and only repaints on a real change.
export function startValuePoll() {
  // Window-scoped guard so a module re-import (hot reload) cannot start a second
  // interval running in parallel.
  if (window.__pixSgValPoll) return;
  window.__pixSgValPoll = setInterval(() => {
    const g = app.canvas?.graph || app.graph;
    if (!g?._nodes) return;
    for (const n of g._nodes) {
      if ((n.type === SET_TYPE || n.type === GET_TYPE) && !n.flags?.collapsed) {
        refreshValue(n);
      }
    }
  }, 450);
}
