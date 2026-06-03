// XY Plot Pixaroma - state schema, target enumeration, value parsing.
//
// State lives on node.properties.xyPlotState (LiteGraph serializes properties
// natively, so it survives save/reload). The per-plot run cursor (sessionId,
// xi, yi, ...) is NOT stored here - it lives on the non-serialized runtime
// field node._pixXyRun (set by the driver in index.js) so it never dirties the
// saved workflow (Vue Compat #18).

import { app } from "/scripts/app.js";

export const STATE_PROP = "xyPlotState";
export const STATE_VERSION = 1;

// One axis: which node+widget to vary, how the values are entered, and the
// resolved value list. `raw` holds the editor's per-mode inputs.
function emptyAxis() {
  return {
    nodeId: null,
    widgetName: null,
    widgetType: null,        // "number" | "combo" | "text" | null
    mode: null,              // number: "range"|"list"; text: "fulllist"|"sr"
    step: 1,
    options: [],             // combo: the widget's option list (cached at pick)
    raw: { start: "", end: "", steps: "", listText: "", checked: [], srFind: "", srReplace: "" },
  };
}

export function defaultState() {
  return {
    version: STATE_VERSION,
    x: emptyAxis(),
    y: emptyAxis(),
    lockSeed: true,
    drawLabels: true,
    saveCells: false,
  };
}

export function readState(node) {
  let s = node?.properties?.[STATE_PROP];
  if (!s || typeof s !== "object" || s.version !== STATE_VERSION) {
    s = defaultState();
    if (node) {
      node.properties = node.properties || {};
      node.properties[STATE_PROP] = s;
    }
  }
  // Backfill any missing axis sub-fields (forward-compat).
  for (const key of ["x", "y"]) {
    s[key] = Object.assign(emptyAxis(), s[key] || {});
    s[key].raw = Object.assign(emptyAxis().raw, s[key].raw || {});
  }
  return s;
}

export function writeState(node, s) {
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = s;
}

export function restoreFromProperties(node) {
  // Idempotent: readState creates+stores a default when absent.
  readState(node);
}

// ── Target enumeration ─────────────────────────────────────────────────────

// Classify a LiteGraph widget into a plottable kind, or null if it can't be
// swept (button / toggle / image / internal / our own widgets).
export function classifyWidget(w) {
  if (!w || !w.name) return null;
  const name = String(w.name);
  if (name.startsWith("$$")) return null;                 // internal (canvas preview, etc.)
  const t = w.type;
  if (typeof t === "string" && t.startsWith("pixaroma_")) return null;
  if (t === "number") {
    const opts = w.options || {};
    let step = opts.step;
    if (typeof step !== "number" || step <= 0) {
      step = Number.isInteger(w.value) ? 1 : 0.01;
    }
    // ComfyUI multiplies the displayed step by 10 internally for some builds;
    // we only need a precision hint, so the raw step is fine.
    return { name, type: "number", step, min: opts.min, max: opts.max };
  }
  if (t === "combo") {
    let vals = w.options?.values;
    if (typeof vals === "function") { try { vals = vals(); } catch (_e) { vals = []; } }
    return { name, type: "combo", options: Array.isArray(vals) ? vals.map(String) : [] };
  }
  if (t === "text" || t === "customtext" || t === "string") {
    return { name, type: "text" };
  }
  return null;
}

// List every graph node (except the XY node itself) that has at least one
// plottable widget. Returns [{nodeId, title, widgets:[{name,type,...}]}].
export function enumerateTargets(xyNode) {
  const graph = xyNode?.graph || app.graph;
  const nodes = graph?._nodes || graph?.nodes || [];
  const out = [];
  for (const n of nodes) {
    if (!n || n === xyNode || n.id === xyNode?.id) continue;
    const widgets = (n.widgets || []).map(classifyWidget).filter(Boolean);
    if (!widgets.length) continue;
    out.push({
      nodeId: n.id,
      title: n.title || n.type || ("Node " + n.id),
      widgets,
    });
  }
  return out;
}

// Look up a fresh classification for an axis's currently-picked widget (so the
// editor can rebuild combo option lists, number steps, etc. after reload).
export function lookupWidgetMeta(node, axis) {
  if (!axis || axis.nodeId == null || !axis.widgetName) return null;
  const graph = node?.graph || app.graph;
  const target = graph?.getNodeById?.(axis.nodeId);
  const w = target?.widgets?.find((x) => x && x.name === axis.widgetName);
  return classifyWidget(w);
}

// ── Value parsing ──────────────────────────────────────────────────────────

export function roundToStep(v, step) {
  if (!step || step <= 0) return v;
  const decimals = (String(step).split(".")[1] || "").length;
  return Number(v.toFixed(Math.min(decimals, 8)));
}

// Comma list, each item a number or an A1111 range:  a-b (+s)  |  a-b [n]
export function parseNumberList(text, step) {
  const out = [];
  for (const part of String(text || "").split(",")) {
    const s = part.trim();
    if (!s) continue;
    const mStep = s.match(/^(-?\d*\.?\d+)\s*-\s*(-?\d*\.?\d+)\s*\(\s*([+-]?\d*\.?\d+)\s*\)$/);
    const mCount = s.match(/^(-?\d*\.?\d+)\s*-\s*(-?\d*\.?\d+)\s*\[\s*(\d+)\s*\]$/);
    if (mStep) {
      const a = parseFloat(mStep[1]); const b = parseFloat(mStep[2]); let st = parseFloat(mStep[3]);
      if (!isFinite(a) || !isFinite(b)) continue;
      if (st === 0) { out.push(roundToStep(a, step)); continue; }
      if ((b - a) * st < 0) st = -st;
      for (let v = a; st > 0 ? v <= b + 1e-9 : v >= b - 1e-9; v += st) out.push(roundToStep(v, step));
    } else if (mCount) {
      const a = parseFloat(mCount[1]); const b = parseFloat(mCount[2]); const n = parseInt(mCount[3], 10);
      if (!isFinite(a)) continue;
      if (!isFinite(b) || n <= 1) { out.push(roundToStep(a, step)); continue; }
      for (let i = 0; i < n; i++) out.push(roundToStep(a + (b - a) * i / (n - 1), step));
    } else {
      const v = parseFloat(s);
      if (isFinite(v)) out.push(roundToStep(v, step));
    }
  }
  return out;
}

export function rangeToList(start, end, steps, step) {
  const a = parseFloat(start); const b = parseFloat(end); const n = parseInt(steps, 10);
  if (!isFinite(a)) return [];
  if (!isFinite(b) || !isFinite(n) || n <= 1) return [roundToStep(a, step)];
  const out = [];
  for (let i = 0; i < n; i++) out.push(roundToStep(a + (b - a) * i / (n - 1), step));
  return out;
}

// Resolve an axis to its ordered list of cell values (numbers or strings).
// For text "sr" mode the values are the replacement strings; the actual text
// substitution happens at inject time against the target's current value.
export function resolveAxisValues(axis) {
  if (!axis || !axis.widgetType) return [];
  const raw = axis.raw || {};
  if (axis.widgetType === "number") {
    if (axis.mode === "list") return parseNumberList(raw.listText, axis.step);
    return rangeToList(raw.start, raw.end, raw.steps, axis.step);
  }
  if (axis.widgetType === "combo") {
    return Array.isArray(raw.checked) ? raw.checked.slice() : [];
  }
  if (axis.widgetType === "text") {
    if (axis.mode === "sr") {
      return String(raw.srReplace || "").split("\n").map((s) => s.trim()).filter((s) => s.length);
    }
    return String(raw.listText || "").split("\n").filter((s) => s.trim().length);
  }
  return [];
}

export function axisReady(axis) {
  return !!(axis && axis.nodeId != null && axis.widgetName && resolveAxisValues(axis).length);
}

export function axisLabels(axis) {
  return resolveAxisValues(axis).map((v) => String(v));
}

// Effective grid dimensions + whether there's anything to plot.
export function computeCounts(state) {
  const xs = axisReady(state.x) ? resolveAxisValues(state.x) : [];
  const ys = axisReady(state.y) ? resolveAxisValues(state.y) : [];
  const cols = xs.length || (ys.length ? 1 : 0);
  const rows = ys.length || (xs.length ? 1 : 0);
  const total = (cols || 1) * (rows || 1);
  return { cols, rows, total, hasPlot: xs.length > 0 || ys.length > 0 };
}
