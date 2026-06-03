import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import {
  readState, restoreFromProperties, resetState,
  resolveAxisValues, axisReady, computeCounts,
} from "./core.mjs";
import { injectCSS, buildRoot, renderBody, measureContentHeight, closePopup } from "./ui.mjs";
import { buildGridPreview } from "./grid.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";
import { isQueueLoopActive, runQueueLoop } from "../shared/queue_drivers.mjs";

const NODE = "PixaromaXYPlot";
// MIN_W is set so the 3 natural-width toggles (Lock seed / Draw labels / Save
// cells) always fit on one row without stretching or wrapping.
const DEFAULT_W = 440, DEFAULT_H = 560;
const MIN_W = 420, MIN_H = 360;
const CHROME = 40;   // title bar + margin above the DOM body

let _sessionCounter = 0;

// ── helpers ─────────────────────────────────────────────────────────────────

function prefixOf(node) {
  const w = node.widgets?.find((x) => x && x.name === "filename_prefix");
  const v = (w && typeof w.value === "string") ? w.value.trim() : "";
  return v || "xy_plot";
}

function isSeedAxis(axis) {
  return axis && (axis.widgetName === "seed" || axis.widgetName === "noise_seed");
}

function captureSeedValue(node) {
  const graph = node?.graph || app.graph;
  const nodes = graph?._nodes || graph?.nodes || [];
  for (const n of nodes) {
    for (const w of (n.widgets || [])) {
      if (w && (w.name === "seed" || w.name === "noise_seed") && typeof w.value === "number") {
        return Math.floor(w.value);
      }
    }
  }
  return 0;
}

function imageWired(node) {
  const inp = (node.inputs || []).find((i) => i && i.name === "image");
  return !!(inp && inp.link != null);
}

function buildViewUrl(f) {
  const params = new URLSearchParams({
    filename: f.filename || "",
    subfolder: f.subfolder || "",
    type: f.type || "temp",
    t: String(Date.now()),
  });
  return `/view?${params.toString()}`;
}

function toast(summary, detail, severity = "warn") {
  const tm = app.extensionManager?.toast;
  if (tm && typeof tm.add === "function") {
    try { tm.add({ severity, summary, detail, life: 4000 }); return; } catch (_e) {}
  }
  console.warn(`[Pixaroma.XYPlot] ${summary}: ${detail}`);
}

function pixConfirmSimple(message) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center;";
    const box = document.createElement("div");
    box.style.cssText = "background:#1d1d1d;border:1px solid #f66744;border-radius:8px;padding:18px 20px;max-width:340px;color:#e0e0e0;font:14px 'Segoe UI',system-ui,sans-serif;";
    box.innerHTML = `<div style="margin-bottom:14px;line-height:1.45">${message}</div>`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    const mk = (label, primary) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `padding:6px 14px;border-radius:5px;border:1px solid ${primary ? "#f66744" : "rgba(255,255,255,.2)"};background:${primary ? "#f66744" : "transparent"};color:#fff;cursor:pointer;font:13px 'Segoe UI',system-ui,sans-serif;`;
      return b;
    };
    const cancel = mk("Cancel", false), ok = mk("Continue", true);
    const done = (v) => { try { back.remove(); } catch (_e) {} document.removeEventListener("keydown", onKey, true); resolve(v); };
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); done(false); }
      else if (e.key === "Enter") { e.stopImmediatePropagation(); done(true); }
    };
    document.addEventListener("keydown", onKey, true);
    back.addEventListener("mousedown", (e) => { if (e.target === back) done(false); });
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(row); back.appendChild(box); document.body.appendChild(back);
  });
}

// ── node lifecycle ───────────────────────────────────────────────────────────

// Grow-only: used while editing controls, so a manual resize-bigger sticks.
function growNode(node, root) {
  requestAnimationFrame(() => {
    const desired = measureContentHeight(root) + CHROME;
    if (desired > node.size[1]) {
      node.size[1] = desired;
      node.setSize?.([node.size[0], desired]);
    }
    node.setDirtyCanvas(true, true);
  });
}

// Fit (grow OR shrink) to content: used when a grid loads / on Reset, so the
// node tightens back up after a smaller plot. Only ever called from genuine
// user actions (executed grid load, Reset) - never on workflow load - so it
// can't trip the dirty-on-load tracker (Vue Compat #18).
function fitNode(node, root) {
  requestAnimationFrame(() => {
    const desired = Math.max(MIN_H, measureContentHeight(root) + CHROME);
    if (Math.abs(desired - node.size[1]) > 1) {
      node.size[1] = desired;
      node.setSize?.([node.size[0], desired]);
    }
    node.setDirtyCanvas(true, true);
  });
}

function makeHandlers(node, root) {
  const handlers = {
    rerender: () => renderBody(node, root, handlers),
    growth: () => growNode(node, root),
    reset: async () => {
      const ok = await pixConfirmSimple("Reset this XY Plot? Both axes and all selections will be cleared.");
      if (!ok) return;
      resetState(node);
      try { node._pixXyGrid?.clear(); } catch (_e) {}
      node._pixXyLastGrid = null;
      handlers.rerender();
      fitNode(node, root);
    },
  };
  return handlers;
}

app.registerExtension({
  name: "Pixaroma.XYPlot",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origCreated) origCreated.apply(this, arguments);
      const node = this;

      // Default == compact; synchronous so configure() (Vue Compat #8) can
      // override with the saved size on reload / duplicate.
      if (!node.size || node.size[0] < MIN_W) node.size[0] = DEFAULT_W;
      if (!node.size || node.size[1] < MIN_H) node.size[1] = DEFAULT_H;

      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const root = buildRoot();
        node._pixXyRoot = root;
        const handlers = makeHandlers(node, root);
        node._pixXyRerender = handlers.rerender;
        node._pixXyFit = () => fitNode(node, root);   // called from grid.mjs on <img> load
        // DOM-only render (no auto-grow) for the load path so the saved size
        // is trusted and the workflow isn't falsely flagged modified (#18).
        node._pixXyRenderOnly = () => renderBody(node, root, { rerender: handlers.rerender, growth: null, reset: handlers.reset });

        const widget = node.addDOMWidget("xyplot", "pixaroma_xy_plot", root, {
          serialize: false,
          getMinHeight: () => measureContentHeight(root) + 4,
        });
        applyAdaptiveCanvasOnly(widget);

        // The grid preview lives in .pix-xy-gridmount and PERSISTS across
        // renderBody() calls (renderBody only rebuilds the axis cards / counter
        // / toggles), so the shown grid isn't wiped when the user edits values.
        const mount = root.querySelector(".pix-xy-gridmount");
        node._pixXyGrid = buildGridPreview(node, mount);
        // Re-show a grid that survived a tab switch.
        if (node._pixXyLastGrid?.url) node._pixXyGrid.setGrid(node._pixXyLastGrid.url);

        node._pixXyRenderOnly();
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      if (this._pixXyRenderOnly) this._pixXyRenderOnly();
      return r;
    };

    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < MIN_W) size[0] = MIN_W;
      if (size[1] < MIN_H) size[1] = MIN_H;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      if (origResize) return origResize.apply(this, arguments);
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { closePopup(); } catch (_e) {}
      this._pixXyRoot = null;
      this._pixXyRerender = null;
      this._pixXyRenderOnly = null;
      this._pixXyGrid = null;
      this._pixXyRun = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// ── value injection hook (Pattern #9) ────────────────────────────────────────

function injectAxis(out, axis, value) {
  if (!axis || axis.nodeId == null || !axis.widgetName) return;
  if (value === undefined || value === null) return;
  const te = out[String(axis.nodeId)];
  if (!te || !te.inputs) return;
  const cur = te.inputs[axis.widgetName];
  if (axis.widgetType === "text" && axis.mode === "sr") {
    const find = axis.raw?.srFind || "";
    if (typeof cur === "string" && find) {
      if (!cur.includes(find)) {
        // The find-text isn't in the target's value - nothing gets replaced,
        // so every cell would look identical. Most common cause: the wrong
        // same-named node was picked (e.g. the negative CLIP Text Encode).
        console.warn(`[Pixaroma.XYPlot] Find & replace: "${find}" not found in the target's text - cells won't differ. Check you picked the right node (the picker shows each setting's current value).`);
      }
      te.inputs[axis.widgetName] = cur.split(find).join(String(value));
    } else if (typeof cur !== "object") {
      te.inputs[axis.widgetName] = String(value);
    }
    return;
  }
  // Don't clobber a wired input (link arrays are objects).
  if (typeof cur === "object" && cur !== null) return;
  te.inputs[axis.widgetName] = value;
}

function applySeedLock(out, seedValue) {
  if (seedValue == null) return;
  for (const k of Object.keys(out)) {
    const e = out[k];
    if (!e || !e.inputs) continue;
    for (const sname of ["seed", "noise_seed"]) {
      if (sname in e.inputs && typeof e.inputs[sname] !== "object") {
        e.inputs[sname] = seedValue;
      }
    }
  }
}

const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const out = result?.output;
    if (out && typeof out === "object") {
      for (const key of Object.keys(out)) {
        const entry = out[key];
        if (!entry || entry.class_type !== NODE) continue;
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        const run = node?._pixXyRun;
        if (!node || !run) continue;   // not in a plot loop → leave normal run alone
        const state = readState(node);
        const payload = {
          sessionId: run.sessionId,
          xi: run.xi, yi: run.yi, cols: run.cols, rows: run.rows,
          xLabels: run.xLabels, yLabels: run.yLabels,
          xName: run.xName, yName: run.yName,
          drawLabels: state.drawLabels !== false,
          saveCells: state.saveCells === true,
          theme: state.theme || "dark",
          prefix: prefixOf(node),
        };
        entry.inputs = entry.inputs || {};
        entry.inputs.XYPlotState = JSON.stringify(payload);
        injectAxis(out, state.x, run.xValue);
        injectAxis(out, state.y, run.yValue);
        if (run.lockSeed) applySeedLock(out, run.lockSeedValue);
      }
    }
  } catch (err) {
    console.error("Pixaroma.XYPlot: graphToPrompt hook failed", err);
  }
  return result;
};

// ── the plot driver (patches app.queuePrompt) ────────────────────────────────

function isXyActive(node) {
  return node.mode !== 2 && node.mode !== 4;
}

function findFirstXyNode() {
  const graph = app.graph;
  if (!graph) return null;
  const consider = (n) => {
    if (!n) return false;
    const isClass = n.comfyClass === NODE || n.type === NODE;
    if (!isClass || !isXyActive(n)) return false;
    return computeCounts(readState(n)).hasPlot;
  };
  const top = graph._nodes || graph.nodes || [];
  for (const n of top) if (consider(n)) return n;
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (consider(n)) return n;
      const sub = n?.subgraph?._nodes || n?.subgraph?.nodes;
      if (sub) { const hit = walk(sub); if (hit) return hit; }
    }
    return null;
  };
  return walk(top);
}

const _origQueuePrompt = app.queuePrompt;
app.queuePrompt = async function (...args) {
  if (isQueueLoopActive()) return _origQueuePrompt.apply(app, args);

  const node = findFirstXyNode();
  if (!node) return _origQueuePrompt.apply(app, args);   // no plot → normal run

  if (!imageWired(node)) {
    toast("XY Plot", "Wire your workflow's image into the XY Plot node before running a plot.");
    return;
  }

  const state = readState(node);
  const xValues = axisReady(state.x) ? resolveAxisValues(state.x) : [];
  const yValues = axisReady(state.y) ? resolveAxisValues(state.y) : [];
  const xs = xValues.length ? xValues : [undefined];
  const ys = yValues.length ? yValues : [undefined];
  const cols = xs.length, rows = ys.length, total = cols * rows;

  if (total > 25) {
    const ok = await pixConfirmSimple(`This will run your workflow <b>${total}</b> times (${cols} × ${rows}). That can take a while. Continue?`);
    if (!ok) return;
  }

  const seedTargeted = isSeedAxis(state.x) || isSeedAxis(state.y);
  const lockSeed = state.lockSeed !== false && !seedTargeted;
  const lockSeedValue = lockSeed ? captureSeedValue(node) : null;

  const sessionId = "xy_" + Date.now() + "_" + (_sessionCounter++);
  const xLabels = xValues.map(String);
  const yLabels = yValues.map(String);
  const xName = (axisReady(state.x) && state.x.widgetName) || "";
  const yName = (axisReady(state.y) && state.y.widgetName) || "";

  return runQueueLoop(async () => {
    let last;
    try {
      for (let yi = 0; yi < rows; yi++) {
        for (let xi = 0; xi < cols; xi++) {
          node._pixXyRun = {
            sessionId, xi, yi, cols, rows,
            xValue: xs[xi], yValue: ys[yi],
            xLabels, yLabels, xName, yName,
            lockSeed, lockSeedValue,
          };
          try {
            const a = args.slice(); a[1] = 1;   // batchCount=1, keep number + queueNodeIds
            last = await _origQueuePrompt.apply(app, a);
          } catch (err) {
            console.error("Pixaroma.XYPlot: cell enqueue failed", err);
          }
        }
      }
    } finally {
      node._pixXyRun = null;   // never leak the cursor into a later normal run
    }
    return last;
  });
};

// ── grid delivery (executed event) ────────────────────────────────────────────

api.addEventListener("executed", ({ detail }) => {
  try {
    let node = app.graph?.getNodeById?.(detail.node);
    if (!node && typeof detail.node === "string") node = app.graph?.getNodeById?.(parseInt(detail.node, 10));
    if (!node || (node.comfyClass !== NODE && node.type !== NODE)) return;
    const frames = detail?.output?.pixaroma_xy_grid;
    if (!frames || !frames.length) return;
    const f = frames[0];
    const url = buildViewUrl(f);
    node._pixXyLastGrid = { sessionId: f._xy?.sessionId || null, filename: f.filename, url };
    node._pixXyGrid?.setGrid(url);
    if (node._pixXyRoot && node._pixXyRerender) {
      // re-measure so the node grows to fit the grid
      requestAnimationFrame(() => node.setDirtyCanvas(true, true));
    }
  } catch (e) {
    console.error("Pixaroma.XYPlot: executed handler failed", e);
  }
});
