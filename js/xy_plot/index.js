import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import {
  readState, restoreFromProperties, resetState, resetAxis as resetAxisCore,
  resolveAxisValues, axisReady, computeCounts,
} from "./core.mjs";
import { injectCSS, buildRoot, renderBody, measureContentHeight, closePopupIfOwner } from "./ui.mjs";
import { buildGridPreview } from "./grid.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/index.mjs";
import { isQueueLoopActive, runQueueLoop, feedsOnlyInactiveSwitch } from "../shared/queue_drivers.mjs";

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

// Capture EACH seed/noise_seed widget's current value, keyed by node id. The
// lock then pins every sampler to its OWN seed across all cells - it keeps each
// constant (so only the swept variable changes), WITHOUT homogenizing two
// different samplers to one shared seed (which the old single-value capture did).
function captureSeedMap(node) {
  const map = {};
  const graph = node?.graph || app.graph;
  for (const n of (graph?._nodes || graph?.nodes || [])) {
    for (const w of (n.widgets || [])) {
      if (w && (w.name === "seed" || w.name === "noise_seed") && typeof w.value === "number") {
        map[String(n.id)] = Math.floor(w.value);
      }
    }
  }
  return map;
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

function pixConfirmSimple(message, onOpen) {
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
    // Let the caller force-dismiss (e.g. node deleted while dialog is open) so
    // the keydown listener can't leak.
    if (onOpen) { try { onOpen(() => done(false)); } catch (_e) {} }
  });
}

// ── node lifecycle ───────────────────────────────────────────────────────────

// Grow-only: used while editing controls, so a manual resize-bigger sticks.
function growNode(node, root) {
  requestAnimationFrame(() => {
    if (!node._pixXyRoot) return;   // node removed between schedule and run
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
    if (!node._pixXyRoot) return;   // node removed between schedule and run
    // Use ComfyUI's own computeSize() for the height target - it accounts for
    // the title bar + slots + the widget's getMinHeight, so it matches what the
    // layout actually wants. (A hand-rolled measureContentHeight + fixed chrome
    // undershot by ~14px, which made this and the layout ping-pong = flicker.)
    let desired;
    try {
      const cs = node.computeSize ? node.computeSize() : null;
      desired = (cs && cs[1]) ? cs[1] : (measureContentHeight(root) + CHROME);
    } catch (_e) {
      desired = measureContentHeight(root) + CHROME;
    }
    desired = Math.max(MIN_H, Math.round(desired));
    if (Math.abs(desired - node.size[1]) > 3) {
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
      // Pass onOpen so onRemoved can dismiss this dialog if the node is deleted
      // while it's open (otherwise its keydown listener would leak).
      const ok = await pixConfirmSimple(
        "Reset this XY Plot? Both axes and all selections will be cleared.",
        (cancel) => { node._pixXyCancelConfirm = cancel; },
      );
      node._pixXyCancelConfirm = null;
      if (!ok) return;
      resetState(node);
      try { node._pixXyGrid?.clear(); } catch (_e) {}
      node._pixXyLastGrid = null;
      handlers.rerender();
      fitNode(node, root);
    },
    // Clear ONE axis (the per-axis ↺ button); the other axis + toggles + any
    // shown grid stay. Fit (not just grow) so the node tightens back up after a
    // tall value area collapses. User action only, so fitNode can't trip the
    // dirty-on-load tracker (Vue Compat #18).
    resetAxis: (axisKey) => {
      resetAxisCore(node, axisKey);
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
        node._pixXyRenderOnly = () => renderBody(node, root, { rerender: handlers.rerender, growth: null, reset: handlers.reset, resetAxis: handlers.resetAxis });

        const widget = node.addDOMWidget("xyplot", "pixaroma_xy_plot", root, {
          serialize: false,
          // Coarse-round to a 4px grid so sub-pixel/font measurement jitter can't
          // creep node.size between save and reload (dirty-on-load, Vue Compat #18).
          getMinHeight: () => Math.round((measureContentHeight(root) + 4) / 4) * 4,
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

        // One-shot legacy fit: a node whose size was grown for a tall grid in
        // the Nodes 2.0 renderer carries that height into legacy, leaving a big
        // empty area below the content. If there's no grid showing and the node
        // is far taller than its content, shrink it to fit (legacy only; Nodes
        // 2.0 manages its own body height). Deferred so the DOM is laid out.
        requestAnimationFrame(() => {
          if (isVueNodes() || node._pixXyLastGrid || !node._pixXyRoot) return;
          const want = Math.max(MIN_H, measureContentHeight(node._pixXyRoot) + CHROME);
          if (node.size[1] > want + 120) {
            node.size[1] = want;
            node.setSize?.([node.size[0], want]);
            node.setDirtyCanvas(true, true);
          }
        });
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
      // Min-size clamp is LEGACY ONLY. In Nodes 2.0 the rendered node size lives
      // in the Vue layout store, not node.size; clamping node.size here desyncs
      // them (drag smaller -> switch workflow -> it jumps back bigger) and the
      // clamp doesn't even constrain the rendered width. The body rows flex-wrap
      // so narrow widths reflow cleanly instead of spilling buttons out the side.
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (origResize) return origResize.apply(this, arguments);
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (isVueNodes()) return;   // size clamp is legacy-only (see onResize)
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { closePopupIfOwner(this); } catch (_e) {}   // only close OUR popup, not another node's
      try { this._pixXyCancelConfirm?.(); } catch (_e) {}
      this._pixXyRoot = null;
      this._pixXyRerender = null;
      this._pixXyRenderOnly = null;
      this._pixXyGrid = null;
      this._pixXyRun = null;
      this._pixXyRunning = false;
      this._pixXyFit = null;
      this._pixXyLastGrid = null;
      this._pixXyGridDims = null;
      this._pixXyExecPrompt = null;
      this._pixXyExecWorkflow = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// ── value injection hook (Pattern #9) ────────────────────────────────────────

// Find a node's entry in the serialized prompt. Top-level nodes are keyed by
// their plain id; nodes inside a subgraph are keyed "<subgraphId>:<nodeId>", so
// fall back to matching on the tail id (otherwise targets in a subgraph never
// get injected and every cell comes out identical).
function findPromptEntry(out, nodeId) {
  const want = String(nodeId);
  const direct = out[want];
  if (direct) return direct;
  for (const k of Object.keys(out)) {
    if (String(k).split(":").pop() === want) return out[k];
  }
  return null;
}

function injectAxis(out, axis, value) {
  if (!axis || axis.nodeId == null || !axis.widgetName) return;
  if (value === undefined || value === null) return;
  const te = findPromptEntry(out, axis.nodeId);
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
    } else if (typeof cur === "object" && cur !== null) {
      // The target's text is wired from another node - find & replace can't run.
      console.warn("[Pixaroma.XYPlot] Find & replace target is a wired input; the text comes from another node so it can't be replaced. Pick a node whose text is typed in directly.");
    } else {
      if (!find) {
        console.warn("[Pixaroma.XYPlot] Find & replace has an empty Find field - each cell REPLACES the whole text with the line instead of substituting. Set a Find term, or use Full list mode.");
      }
      te.inputs[axis.widgetName] = String(value);
    }
    return;
  }
  // Number / combo / text(full-list): inject the swept value, OVERRIDING a
  // wired input if there is one. A converted-to-input widget (e.g. Empty Latent
  // Image's `width` wired from Resolution Pixaroma) appears in the prompt as a
  // link array `[nodeId, slot]`; the user explicitly chose to vary this input,
  // so replace the link with each cell's literal value (otherwise the plot
  // would silently do nothing and every cell would look identical).
  te.inputs[axis.widgetName] = value;
}

// Pin every seed/noise_seed to the value captured for THAT node (keeps each
// sampler's seed constant across cells without forcing them all equal).
// Match by EXACT prompt key (= the node id for a top-level node, which is how
// captureSeedMap keys them). A tail-id match would collide across subgraph
// scopes ("12:5" and a top-level "5" both ending in 5) and pin the wrong seed.
function applySeedLock(out, seedMap) {
  if (!seedMap) return;
  for (const k of Object.keys(out)) {
    const e = out[k];
    if (!e || !e.inputs) continue;
    const v = seedMap[k];
    if (v == null) continue;
    for (const sname of ["seed", "noise_seed"]) {
      if (sname in e.inputs && typeof e.inputs[sname] !== "object") {
        e.inputs[sname] = v;
      }
    }
  }
}

// Subgraph-safe node lookup (mirrors text_overlay): app.graph.getNodeById only
// resolves top-level nodes, so a plain parseInt(tail) misses an XY Plot node
// placed inside a subgraph (its XYPlotState never gets injected). Walk nested
// subgraphs and match by id / tail id. (Axis VALUE injection already uses the
// subgraph-safe findPromptEntry above; this fixes the node's OWN state lookup.)
function buildPixXyNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === NODE || n.type === NODE) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}
function findPixXyNode(index, promptId) {
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
    const out = result?.output;
    if (out && typeof out === "object") {
      let index = null;
      for (const key of Object.keys(out)) {
        const entry = out[key];
        if (!entry || entry.class_type !== NODE) continue;
        if (!index) index = buildPixXyNodeIndex();
        const node = findPixXyNode(index, key);
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
        if (run.lockSeed) applySeedLock(out, run.seedMap);
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
    // Must actually participate in THIS run: have a plot configured, have its
    // image input wired (no image = nothing to plot), and not feed only an
    // inactive Switch branch. An orphaned/unwired XY node must fall through to
    // a normal run, NOT hijack or block it (mirrors Prompt Multi/Pack).
    if (!imageWired(n)) return false;
    if (!computeCounts(readState(n)).hasPlot) return false;
    if (feedsOnlyInactiveSwitch(n)) return false;
    return true;
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
  if (!node) return _origQueuePrompt.apply(app, args);   // no participating plot → normal run

  // Re-entrancy guard: a second Run while the >25 confirm is open (or mid-loop)
  // must not start a parallel plot. The shared lock only covers the loop itself;
  // this covers the await-confirm window too.
  if (node._pixXyRunning) return;
  node._pixXyRunning = true;
  try {
    const state = readState(node);
    const xValues = axisReady(state.x) ? resolveAxisValues(state.x) : [];
    const yValues = axisReady(state.y) ? resolveAxisValues(state.y) : [];
    const xs = xValues.length ? xValues : [undefined];
    const ys = yValues.length ? yValues : [undefined];
    const cols = xs.length, rows = ys.length, total = cols * rows;

    if (total > 25) {
      const ok = await pixConfirmSimple(
        `This will run your workflow <b>${total}</b> times (${cols} × ${rows}). That can take a while. Continue?`,
        (cancel) => { node._pixXyCancelConfirm = cancel; },
      );
      node._pixXyCancelConfirm = null;
      if (!ok) return;
    }

    const seedTargeted = isSeedAxis(state.x) || isSeedAxis(state.y);
    const lockSeed = state.lockSeed !== false && !seedTargeted;
    const seedMap = lockSeed ? captureSeedMap(node) : null;

    const sessionId = "xy_" + Date.now() + "_" + (_sessionCounter++);
    const xLabels = xValues.map(String);
    const yLabels = yValues.map(String);
    const xName = (axisReady(state.x) && state.x.widgetName) || "";
    const yName = (axisReady(state.y) && state.y.widgetName) || "";

    return await runQueueLoop(async () => {
      let last;
      try {
        for (let yi = 0; yi < rows; yi++) {
          for (let xi = 0; xi < cols; xi++) {
            node._pixXyRun = {
              sessionId, xi, yi, cols, rows,
              xValue: xs[xi], yValue: ys[yi],
              xLabels, yLabels, xName, yName,
              lockSeed, seedMap,
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
  } finally {
    node._pixXyRunning = false;
  }
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
    // Capture the EXECUTION-time prompt + workflow so Save Output embeds the
    // seed that ACTUALLY produced the grid (the live graph's seed has already
    // been bumped by 'control after generate: randomize' by save-click time).
    // Runtime-only - never persist to node.properties (Preview Pattern #13).
    const meta = f._pixaroma_meta;
    if (meta && typeof meta === "object") {
      node._pixXyExecPrompt = meta.prompt || null;
      node._pixXyExecWorkflow = meta.workflow || null;
    }
    node._pixXyGrid?.setGrid(url);
    // The node's actual resize-to-fit happens in the grid <img> onload handler
    // (grid.mjs -> _pixXyFit); here we just request a repaint.
    requestAnimationFrame(() => { try { node.setDirtyCanvas?.(true, true); } catch (_e) {} });
  } catch (e) {
    console.error("Pixaroma.XYPlot: executed handler failed", e);
  }
});
