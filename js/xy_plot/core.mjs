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
    theme: "dark",          // grid color theme: "dark" | "light" | "mono"
  };
}

// Backfill missing fields on an axis IN PLACE and return the SAME object.
// Critical: we must NOT replace the axis object on each read - editor event
// handlers capture state.x / state.y by reference, so swapping in a fresh copy
// on the next read makes a later save() write a stale snapshot that clobbers
// the other axis (symptom: editing X wipes Y's values, so the node thinks
// there's nothing to plot and Run does a normal single run instead).
function backfillAxis(axis) {
  if (!axis || typeof axis !== "object") return emptyAxis();
  const def = emptyAxis();
  for (const k in def) if (!(k in axis)) axis[k] = def[k];
  if (!axis.raw || typeof axis.raw !== "object") {
    axis.raw = def.raw;
  } else {
    const dr = def.raw;
    for (const k in dr) if (!(k in axis.raw)) axis.raw[k] = dr[k];
  }
  return axis;
}

export function readState(node) {
  let s = node?.properties?.[STATE_PROP];
  if (!s || typeof s !== "object" || s.version !== STATE_VERSION) {
    s = defaultState();
    if (node) {
      node.properties = node.properties || {};
      node.properties[STATE_PROP] = s;
    }
    return s;
  }
  s.x = backfillAxis(s.x);
  s.y = backfillAxis(s.y);
  return s;
}

export function writeState(node, s) {
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = s;
}

// Wipe back to fresh defaults (both axes empty, toggles at their defaults).
export function resetState(node) {
  const s = defaultState();
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = s;
  return s;
}

export function restoreFromProperties(node) {
  // Idempotent: readState creates+stores a default when absent.
  readState(node);
}

// ── Target enumeration ─────────────────────────────────────────────────────

// A short, one-line preview of a widget's current value - lets the picker
// disambiguate two same-titled nodes (e.g. positive vs negative CLIP Text
// Encode, both "CLIP Text Encode (Prompt) · text").
function previewValue(w) {
  let v = w?.value;
  if (v == null) return "";
  v = String(v).replace(/\s+/g, " ").trim();
  return v.length > 46 ? v.slice(0, 46) + "…" : v;
}

// Classify a LiteGraph widget into a plottable kind, or null if it can't be
// swept (button / toggle / image / internal / our own widgets).
export function classifyWidget(w) {
  if (!w || !w.name) return null;
  const name = String(w.name);
  if (name.startsWith("$$")) return null;                 // internal (canvas preview, etc.)
  const t = w.type;
  if (typeof t === "string" && t.startsWith("pixaroma_")) return null;
  // Skip hidden / internal serialized-state widgets (e.g. Note's note_json,
  // Label's label_json) - they're hidden via hideJsonWidget (w.hidden = true)
  // and hold a JSON blob, not a parameter anyone would sweep.
  if (w.hidden || t === "hidden") return null;
  if (w.options && w.options.canvasOnly === true) return null;
  const cur = previewValue(w);
  if (t === "number") {
    const opts = w.options || {};
    let step = opts.step;
    if (typeof step !== "number" || step <= 0) {
      step = Number.isInteger(w.value) ? 1 : 0.01;
    }
    // ComfyUI multiplies the displayed step by 10 internally for some builds;
    // we only need a precision hint, so the raw step is fine.
    return { name, type: "number", step, min: opts.min, max: opts.max, cur };
  }
  if (t === "combo") {
    let vals = w.options?.values;
    if (typeof vals === "function") { try { vals = vals(); } catch (_e) { vals = []; } }
    return { name, type: "combo", options: Array.isArray(vals) ? vals.map(String) : [], cur };
  }
  if (t === "text" || t === "customtext" || t === "string") {
    return { name, type: "text", cur };
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
  // Sort by title so identically-named nodes (e.g. the two CLIP Text Encode
  // (Prompt) nodes) sit next to each other instead of scattered in arbitrary
  // graph order - the user compares their previews side by side and picks the
  // right one. Stable secondary sort by node id.
  out.sort((a, b) => {
    const t = String(a.title).localeCompare(String(b.title));
    if (t !== 0) return t;
    return String(a.nodeId).localeCompare(String(b.nodeId), undefined, { numeric: true });
  });
  return out;
}

// Live one-line preview of the CURRENT value of the widget an axis points at,
// so the node body can show "now: watermark, text" and a wrong-node pick (two
// same-titled CLIP Text Encode nodes) is obvious without opening the picker.
export function currentValuePreview(node, axis) {
  if (!axis || axis.nodeId == null || !axis.widgetName) return "";
  const graph = node?.graph || app.graph;
  const target = graph?.getNodeById?.(axis.nodeId);
  const w = target?.widgets?.find((x) => x && x.name === axis.widgetName);
  if (!w || w.value == null) return "";
  const v = String(w.value).replace(/\s+/g, " ").trim();
  return v.length > 48 ? v.slice(0, 48) + "…" : v;
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

// Hard cap on how many values a single axis can produce, so a typo like
// "1-100000 [99999]" or "0-1 (+0.0000001)" can't allocate a giant array or
// freeze the browser. A comparison grid is only useful for a handful of cells.
export const MAX_AXIS_VALUES = 100;

// Trim float drift to the step's decimal precision. Handles scientific-notation
// steps (e.g. 1e-7) which `String(step).split(".")` would mis-read as 0 decimals
// (collapsing every value to 0).
export function roundToStep(v, step) {
  if (!step || step <= 0 || !isFinite(v)) return v;
  let decimals;
  const s = String(step);
  if (s.indexOf("e") >= 0 || s.indexOf("E") >= 0) {
    // scientific notation: derive decimals from the exponent
    decimals = Math.max(0, Math.ceil(-Math.log10(Math.abs(step))));
  } else {
    decimals = (s.split(".")[1] || "").length;
  }
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
      if (st === 0 || !isFinite(st)) { out.push(roundToStep(a, step)); continue; }
      if ((b - a) * st < 0) st = -st;
      // Iterate by integer index (count = how many steps fit), NOT by repeated
      // `v += st`: accumulation drift would drop or duplicate the endpoint, and
      // a tiny step (e.g. +0.0000001) would loop millions of times. Capped.
      const count = Math.min(MAX_AXIS_VALUES - 1, Math.max(0, Math.floor((b - a) / st + 1e-9)));
      for (let i = 0; i <= count && out.length < MAX_AXIS_VALUES; i++) {
        out.push(roundToStep(a + i * st, step));
      }
    } else if (mCount) {
      const a = parseFloat(mCount[1]); const b = parseFloat(mCount[2]); let n = parseInt(mCount[3], 10);
      if (!isFinite(a)) continue;
      if (!isFinite(b) || n <= 1) { out.push(roundToStep(a, step)); continue; }
      n = Math.min(n, MAX_AXIS_VALUES);
      for (let i = 0; i < n && out.length < MAX_AXIS_VALUES; i++) out.push(roundToStep(a + (b - a) * i / (n - 1), step));
    } else {
      const v = parseFloat(s);
      if (isFinite(v) && out.length < MAX_AXIS_VALUES) out.push(roundToStep(v, step));
    }
    if (out.length >= MAX_AXIS_VALUES) break;
  }
  return out;
}

export function rangeToList(start, end, steps, step) {
  const a = parseFloat(start); const b = parseFloat(end); let n = parseInt(steps, 10);
  if (!isFinite(a)) return [];
  if (!isFinite(b) || !isFinite(n) || n <= 1) return [roundToStep(a, step)];
  n = Math.min(n, MAX_AXIS_VALUES);
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
    const checked = Array.isArray(raw.checked) ? raw.checked.slice() : [];
    // Drop selections that no longer exist in the widget's current options
    // (e.g. a sampler/checkpoint removed after a model-list change), so we don't
    // inject a stale value the target node would reject. Only filter when we
    // actually know the live options; otherwise keep them all.
    const opts = axis.options;
    if (Array.isArray(opts) && opts.length) {
      const set = new Set(opts);
      return checked.filter((v) => set.has(v));
    }
    return checked;
  }
  if (axis.widgetType === "text") {
    if (axis.mode === "sr") {
      return String(raw.srReplace || "").split("\n").map((s) => s.trim()).filter((s) => s.length);
    }
    return String(raw.listText || "").split("\n").map((s) => s.trim()).filter((s) => s.length);
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
  const hasPlot = xs.length > 0 || ys.length > 0;
  const total = hasPlot ? (cols || 1) * (rows || 1) : 0;
  return { cols, rows, total, hasPlot };
}
