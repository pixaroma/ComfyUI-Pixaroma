// XY Plot Pixaroma - state schema, target enumeration, value parsing.
//
// State lives on node.properties.xyPlotState (LiteGraph serializes properties
// natively, so it survives save/reload). The per-plot run cursor (sessionId,
// xi, yi, ...) is NOT stored here - it lives on the non-serialized runtime
// field node._pixXyRun (set by the driver in index.js) so it never dirties the
// saved workflow (Vue Compat #18).

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

export const STATE_PROP = "xyPlotState";
export const STATE_VERSION = 1;

// One axis: which node+widget to vary, how the values are entered, and the
// resolved value list. `raw` holds the editor's per-mode inputs.
function emptyAxis() {
  return {
    nodeId: null,
    widgetName: null,
    // subField is NOT defaulted here on purpose: object-valued lora rows set it to
    // "lora"|"strength"|"strengthTwo" at pick time (a user action). Leaving it out of
    // the default shape means backfillAxis never ADDS it to a pre-existing axis on the
    // load path, so opening an older saved workflow can't dirty it (Vue Compat #18).
    // Every read normalizes a missing subField to "lora" (via `axis.subField || "lora"`).
    widgetType: null,        // "number" | "combo" | "text" | null
    mode: null,              // number: "range"|"list"; text: "fulllist"|"sr"
    step: 1,
    precision: null,         // number: decimals the field allows (0=int, 1=cfg, 2=denoise)
    realStep: null,          // number: the field's true increment (step2), for snap-to-step
    snap: true,              // number: round values to realStep (per-axis Snap toggle)
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
    saveMaxSize: "4096",    // Save-button export size: "2048"|"4096"|"8192"|"full"
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

// Clear a SINGLE axis back to empty IN PLACE (preserving the object identity that
// editor handlers captured by reference - same aliasing rule as backfillAxis /
// selectChoice). The OTHER axis + the toggles/theme are left untouched. Backs the
// per-axis ↺ reset button.
export function resetAxis(node, axisKey) {
  const state = readState(node);
  const axis = state[axisKey];
  if (!axis) return state;
  axis.nodeId = null;
  axis.widgetName = null;
  axis.subField = null;
  axis.widgetType = null;
  axis.mode = null;
  axis.step = 1;
  axis.options = [];
  const r = axis.raw || (axis.raw = {});
  r.start = ""; r.end = ""; r.steps = ""; r.listText = "";
  r.checked = []; r.srFind = ""; r.srReplace = "";
  writeState(node, state);
  return state;
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

// ── LoRA options (for object-valued lora rows) ─────────────────────────────
//
// Multi-lora loaders (e.g. rgthree's Power Lora Loader) store each lora row as an
// OBJECT widget value {on, lora, strength, ...} under a non-standard widget type,
// so classifyWidget can't read an options list off the widget the way it does for
// the core Load LoRA node's `lora_name` combo. We harvest the full lora filename
// list from ComfyUI's node definitions (always registered) + any live lora_name
// combo on the graph, and cache it.
let _loraOptions = null;
let _loraFetchStarted = false;

// Keep only real lora FILES. The "None" sentinel is a "no lora" placeholder some
// loader nodes (e.g. ComfyUI-Easy-Use) add to their lora_name combo; since we
// harvest the list across every node that has a lora_name input, that sentinel
// would otherwise leak in and confuse (it is not a file, and the core Load LoRA
// dropdown never shows it). A genuine lora would be "None.safetensors", not "None".
function isLoraFileName(v) {
  return typeof v === "string" && v.length > 0 && v.toLowerCase() !== "none";
}

function harvestLorasSync() {
  const set = new Set();
  try {
    const reg = (window.LiteGraph && window.LiteGraph.registered_node_types) || {};
    for (const key of Object.keys(reg)) {
      const inp = reg[key] && reg[key].nodeData && reg[key].nodeData.input;
      if (!inp) continue;
      const spec = (inp.required && inp.required.lora_name) || (inp.optional && inp.optional.lora_name);
      const vals = Array.isArray(spec) ? spec[0] : null;
      if (Array.isArray(vals)) for (const v of vals) if (isLoraFileName(v)) set.add(v);
    }
  } catch (_e) {}
  try {
    const nodes = app.graph?._nodes || app.graph?.nodes || [];
    for (const n of nodes) for (const w of (n.widgets || [])) {
      if (w && w.name === "lora_name") {
        let vals = w.options && w.options.values;
        if (typeof vals === "function") { try { vals = vals(); } catch (_e2) { vals = null; } }
        if (Array.isArray(vals)) for (const v of vals) if (isLoraFileName(v)) set.add(v);
      }
    }
  } catch (_e) {}
  return set;
}

// One-time async warm-up: pull the full lora list from ComfyUI's object_info so
// the cache is complete even if the sync sources are momentarily sparse. Unions
// into (never shrinks) the cache.
function warmLoraCacheAsync() {
  if (_loraFetchStarted) return;
  _loraFetchStarted = true;
  (async () => {
    try {
      const defs = api && api.getNodeDefs ? await api.getNodeDefs() : null;
      if (!defs) return;
      const set = new Set(_loraOptions || []);
      for (const key of Object.keys(defs)) {
        const inp = defs[key] && defs[key].input;
        const spec = inp && ((inp.required && inp.required.lora_name) || (inp.optional && inp.optional.lora_name));
        const vals = Array.isArray(spec) ? spec[0] : null;
        if (Array.isArray(vals)) for (const v of vals) if (isLoraFileName(v)) set.add(v);
      }
      if (set.size) _loraOptions = [...set].sort();
    } catch (_e) {}
  })();
}

// The available lora filenames, always including `extra` (the row's current pick)
// so a live selection is never dropped even if the harvest missed it.
export function loraOptions(extra) {
  warmLoraCacheAsync();
  if (!_loraOptions || !_loraOptions.length) {
    const sync = harvestLorasSync();
    if (sync.size) _loraOptions = [...sync].sort();
  }
  const set = new Set(_loraOptions || []);
  if (extra) {
    for (const v of (Array.isArray(extra) ? extra : [extra])) if (typeof v === "string" && v) set.add(v);
  }
  return [...set].sort();
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
  // and hold a JSON blob, not a parameter anyone would sweep. EXCEPTION: a widget
  // flagged w.pixSweepable is a genuine numeric parameter that is hidden only
  // because a DOM slider replaced its face (Outpaint Stitch's feather /
  // color_match) - it stays pickable.
  if (!w.pixSweepable) {
    if (w.hidden || t === "hidden") return null;
    if (w.options && w.options.canvasOnly === true) return null;
  }
  // Object-valued lora rows are handled by classifyWidgetEntries (they yield MULTIPLE
  // plottable axes: the lora name + its strength[s]); classifyWidget only handles
  // single-value number/combo/text widgets, so bail for those here.
  if (isLoraRowValue(w.value)) return null;
  const cur = previewValue(w);
  // "slider" is a numeric widget too (an INT/FLOAT declared with display:"slider").
  // It carries the same min/max/step/precision, so sweep it exactly like a number -
  // e.g. Outpaint Stitch's color_match. Classify it AS "number" so the whole axis
  // pipeline (range/list entry, rounding, injection) treats it uniformly.
  if (t === "number" || t === "slider") {
    const opts = w.options || {};
    let step = opts.step;
    if (typeof step !== "number" || step <= 0) {
      step = Number.isInteger(w.value) ? 1 : 0.01;
    }
    // ComfyUI declares how many decimals a number field allows via `precision`
    // (0 = integer like width/height/steps/seed, 1 = cfg, 2 = denoise). That is
    // the AUTHORITATIVE rounding source - the `step` option is ×10-inflated and
    // unreliable. roundToStep() rounds to `precision` when present (integer fields
    // stay whole; 7.1 keeps its decimal) and only falls back to step/value decimals
    // when precision is missing (old saved axis / non-ComfyUI widget).
    const precision = (typeof opts.precision === "number") ? opts.precision : null;
    // step2 is the REAL increment (width 16, cfg 0.1); used by the Snap-to-step toggle.
    const realStep = (typeof opts.step2 === "number" && opts.step2 > 0) ? opts.step2 : null;
    return { name, type: "number", step, precision, realStep, min: opts.min, max: opts.max, cur };
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

// True when a widget value is an object-valued lora ROW (rgthree Power Lora Loader
// and similar multi-lora loaders): { on, lora, strength, strengthTwo? }.
function isLoraRowValue(v) {
  return !!(v && typeof v === "object" && !Array.isArray(v) &&
    ("lora" in v) && ("strength" in v || "on" in v));
}

// The plottable axes a single lora ROW exposes: the lora NAME (a combo of files),
// its model STRENGTH (a number), and - only when the loader is in "Separate Model &
// Clip" mode - its clip strength. Each entry keeps the SAME identity `name` (the
// widget key, e.g. "lora_1") and is disambiguated by `subField`; `label` is the
// friendly display string. Injection reaches the right dict key via subField.
function loraRowEntries(name, val) {
  const out = [];
  const curLora = (typeof val.lora === "string" && val.lora !== "None") ? val.lora : "";
  out.push({ name, subField: "lora", label: name, type: "combo", options: loraOptions(curLora), cur: curLora });
  const st = (typeof val.strength === "number") ? val.strength : 1;
  // precision 2 mirrors the loader's own 2-decimal strength; realStep null = no
  // snap toggle (users type exact weights like 0.1 / 0.35 / 1.0).
  out.push({ name, subField: "strength", label: name + " strength", type: "number", step: 0.05, precision: 2, realStep: null, cur: String(st) });
  if (typeof val.strengthTwo === "number") {
    out.push({ name, subField: "strengthTwo", label: name + " clip strength", type: "number", step: 0.05, precision: 2, realStep: null, cur: String(val.strengthTwo) });
  }
  return out;
}

// All plottable axes for ONE widget. A lora row yields several (name + strength[s]);
// everything else yields 0 or 1 (delegating to classifyWidget). The skip guards
// mirror classifyWidget so an internal/hidden lora-shaped widget is still excluded.
export function classifyWidgetEntries(w) {
  if (!w || !w.name) return [];
  const name = String(w.name);
  if (name.startsWith("$$")) return [];
  const t = w.type;
  if (typeof t === "string" && t.startsWith("pixaroma_")) return [];
  if (!w.pixSweepable) {                 // see classifyWidget for the exception
    if (w.hidden || t === "hidden") return [];
    if (w.options && w.options.canvasOnly === true) return [];
  }
  if (isLoraRowValue(w.value)) return loraRowEntries(name, w.value);
  const single = classifyWidget(w);
  return single ? [single] : [];
}

// Friendly display name for an axis (used on the grid + in the picker readout):
// "lora_1", "lora_1 strength", "lora_1 clip strength", or the plain widget name.
export function axisDisplayName(axis) {
  if (!axis || !axis.widgetName) return "";
  if (axis.subField === "strength") return axis.widgetName + " strength";
  if (axis.subField === "strengthTwo") return axis.widgetName + " clip strength";
  return axis.widgetName;
}

// List every graph node (except the XY node itself) that has at least one
// plottable widget. Returns [{nodeId, title, widgets:[{name,type,...}]}].
export function enumerateTargets(xyNode) {
  const graph = xyNode?.graph || app.graph;
  const nodes = graph?._nodes || graph?.nodes || [];
  const out = [];
  for (const n of nodes) {
    if (!n || n === xyNode || n.id === xyNode?.id) continue;
    const widgets = (n.widgets || []).flatMap(classifyWidgetEntries).filter(Boolean);
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
  let raw = w.value;
  // Object-valued lora rows (Power Lora Loader): show the sub-field this axis
  // targets (the lora file, or the strength number), not "[object Object]".
  if (raw && typeof raw === "object" && !Array.isArray(raw) && ("lora" in raw)) {
    const sf = axis.subField || "lora";
    if (sf === "strength") raw = (raw.strength != null ? raw.strength : "");
    else if (sf === "strengthTwo") raw = (raw.strengthTwo != null ? raw.strengthTwo : "");
    else raw = raw.lora || "None";
  }
  const v = String(raw).replace(/\s+/g, " ").trim();
  return v.length > 48 ? v.slice(0, 48) + "…" : v;
}

// Look up a fresh classification for an axis's currently-picked widget (so the
// editor can rebuild combo option lists, number steps, etc. after reload). For an
// object-valued lora row the widget yields several entries - return the one that
// matches this axis's subField.
export function lookupWidgetMeta(node, axis) {
  if (!axis || axis.nodeId == null || !axis.widgetName) return null;
  const graph = node?.graph || app.graph;
  const target = graph?.getNodeById?.(axis.nodeId);
  const w = target?.widgets?.find((x) => x && x.name === axis.widgetName);
  if (!w) return null;
  const entries = classifyWidgetEntries(w);
  if (entries.length <= 1) return entries[0] || null;
  const sf = axis.subField || "lora";
  return entries.find((e) => (e.subField || "lora") === sf) || entries[0] || null;
}

// ── Value parsing ──────────────────────────────────────────────────────────

// Hard cap on how many values a single axis can produce, so a typo like
// "1-100000 [99999]" or "0-1 (+0.0000001)" can't allocate a giant array or
// freeze the browser. A comparison grid is only useful for a handful of cells.
export const MAX_AXIS_VALUES = 100;

// Count a number's decimal places, handling scientific notation (e.g. 1e-7 -> 7,
// 1.5e-3 -> 4) which a naive String().split(".") mis-reads as 0 decimals.
function decimalsOf(n) {
  if (!isFinite(n)) return 0;
  const s = String(n);
  const e = s.search(/[eE]/);
  if (e >= 0) {
    const mantDec = (s.slice(0, e).split(".")[1] || "").length;
    const exp = parseInt(s.slice(e + 1), 10) || 0;
    return Math.max(0, mantDec - exp);
  }
  return (s.split(".")[1] || "").length;
}

// Round a value to the right number of decimals. `precision` (from the widget:
// 0 = integer width/height/steps/seed, 1 = cfg, 2 = denoise) is authoritative and
// is used when present - so integer fields stay WHOLE (e.g. a 512->1024 range no
// longer yields 682.66666667) while cfg keeps 1 decimal and denoise 2. When
// precision is unknown, fall back to preserving the value's own decimals (capped
// at 8 to trim float-accumulation drift, which lives ~15-17 places down).
// Scientific-notation safe via decimalsOf().
export function roundToStep(v, step, precision) {
  if (!isFinite(v)) return v;
  if (typeof precision === "number" && precision >= 0) {
    return Number(v.toFixed(Math.min(precision, 8)));
  }
  const stepDec = (typeof step === "number" && step > 0) ? decimalsOf(step) : 0;
  const dec = Math.min(8, Math.max(stepDec, decimalsOf(v)));
  return Number(v.toFixed(dec));
}

// Comma list, each item a number or an A1111 range:  a-b (+s)  |  a-b [n]
export function parseNumberList(text, step, precision) {
  const out = [];
  for (const part of String(text || "").split(",")) {
    const s = part.trim();
    if (!s) continue;
    const mStep = s.match(/^(-?\d*\.?\d+)\s*-\s*(-?\d*\.?\d+)\s*\(\s*([+-]?\d*\.?\d+)\s*\)$/);
    const mCount = s.match(/^(-?\d*\.?\d+)\s*-\s*(-?\d*\.?\d+)\s*\[\s*(\d+)\s*\]$/);
    if (mStep) {
      const a = parseFloat(mStep[1]); const b = parseFloat(mStep[2]); let st = parseFloat(mStep[3]);
      if (!isFinite(a) || !isFinite(b)) continue;
      if (st === 0 || !isFinite(st)) { out.push(roundToStep(a, step, precision)); continue; }
      if ((b - a) * st < 0) st = -st;
      // Iterate by integer index (count = how many steps fit), NOT by repeated
      // `v += st`: accumulation drift would drop or duplicate the endpoint, and
      // a tiny step (e.g. +0.0000001) would loop millions of times. Capped.
      const count = Math.min(MAX_AXIS_VALUES - 1, Math.max(0, Math.floor((b - a) / st + 1e-9)));
      for (let i = 0; i <= count && out.length < MAX_AXIS_VALUES; i++) {
        out.push(roundToStep(a + i * st, step, precision));
      }
    } else if (mCount) {
      const a = parseFloat(mCount[1]); const b = parseFloat(mCount[2]); let n = parseInt(mCount[3], 10);
      if (!isFinite(a)) continue;
      if (!isFinite(b) || n <= 1) { out.push(roundToStep(a, step, precision)); continue; }
      n = Math.min(n, MAX_AXIS_VALUES);
      for (let i = 0; i < n && out.length < MAX_AXIS_VALUES; i++) out.push(roundToStep(a + (b - a) * i / (n - 1), step, precision));
    } else {
      const v = parseFloat(s);
      if (isFinite(v) && out.length < MAX_AXIS_VALUES) out.push(roundToStep(v, step, precision));
    }
    if (out.length >= MAX_AXIS_VALUES) break;
  }
  return out;
}

export function rangeToList(start, end, steps, step, precision) {
  const a = parseFloat(start); const b = parseFloat(end); let n = parseInt(steps, 10);
  if (!isFinite(a)) return [];
  if (!isFinite(b) || !isFinite(n) || n <= 1) return [roundToStep(a, step, precision)];
  n = Math.min(n, MAX_AXIS_VALUES);
  const out = [];
  for (let i = 0; i < n; i++) out.push(roundToStep(a + (b - a) * i / (n - 1), step, precision));
  return out;
}

// Snap a number to the nearest multiple of the field's real step (e.g. width to
// multiples of 16), then clean any float artifact to the field's precision.
function snapToGrid(v, realStep, precision) {
  if (!realStep || realStep <= 0 || !isFinite(v)) return v;
  return roundToStep(Math.round(v / realStep) * realStep, realStep, precision);
}

// Resolve an axis to its ordered list of cell values (numbers or strings).
// Number values are snapped to the field's real step when the axis's Snap toggle
// is on (axis.snap, default true). For text "sr" mode the values are the
// replacement strings; substitution happens at inject time against the target.
export function resolveAxisValues(axis) {
  if (!axis || !axis.widgetType) return [];
  const raw = axis.raw || {};
  if (axis.widgetType === "number") {
    let vals = (axis.mode === "list")
      ? parseNumberList(raw.listText, axis.step, axis.precision)
      : rangeToList(raw.start, raw.end, raw.steps, axis.step, axis.precision);
    if (axis.snap !== false && axis.realStep) vals = vals.map((v) => snapToGrid(v, axis.realStep, axis.precision));
    return vals;
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
