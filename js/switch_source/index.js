import { app } from "/scripts/app.js";
import {
  STATE_PROP, MAX_ROWS, CONTROL_BAND,
  readState, writeState,
  setupNode, restoreFromProperties, rebuildSlots,
  updateOutputLabels, rowCount, highestWiredRow,
  outputLabelRect, outputLabelScreenRect, pointInRect,
} from "./core.mjs";
import { openLabelEditor, cancelEditorForNode } from "./editor.mjs";
import { makeNumericInput, injectResizePanelCSS } from "../shared/resize_panel.mjs";

// Switch Source Pixaroma - two banks (A/B), one toggle flips every row.
// Slot count is set by the Rows field (not by wiring); editable output labels;
// a Missing-side mode (Use connected / Strict). State on
// node.properties.switchSourceState, injected + pruned at submit time by the
// app.graphToPrompt hook (Pattern #9, same family as Switch / Switch WH).

const BRAND = "#f66744";
const HIDDEN_INPUT_NAME = "SwitchSourceState";
const MIN_W = 250;

// Load guard (mirrors Switch): the per-node configuring flag does NOT cover
// LiteGraph's graph-level connection replay, which fires onConnectionsChange
// AFTER each node's onConfigure returns. Wrapping app.loadGraphData (the funnel
// for open / tab switch / Ctrl+Z) gives a load-wide guard with a 300ms trailing
// window for the link restore that settles a tick later (Vue Compat #19).
let _ssLoadingGraph = false;
if (app && app.loadGraphData && !app._pixSsLoadWrapped) {
  app._pixSsLoadWrapped = true;
  const _origLoad = app.loadGraphData.bind(app);
  app.loadGraphData = function (...args) {
    _ssLoadingGraph = true;
    let r;
    try { r = _origLoad(...args); }
    finally { Promise.resolve(r).finally(() => setTimeout(() => { _ssLoadingGraph = false; }, 300)); }
    return r;
  };
}

function injectCSS() {
  if (document.getElementById("pix-switchsrc-css")) return;
  const s = document.createElement("style");
  s.id = "pix-switchsrc-css";
  s.textContent = `
    .pix-ss-root { display:flex; flex-direction:column; gap:6px; padding:6px; box-sizing:border-box; width:100%; }
    .pix-ss-row { display:flex; gap:6px; align-items:stretch; }
    .pix-ss-rowsfield {
      display:inline-flex; align-items:center; flex:1;
      background:#1d1d1d; border:1px solid #444; border-radius:6px; overflow:hidden;
    }
    .pix-ss-rowsfield:focus-within { border-color:${BRAND}; }
    .pix-ss-rows-label {
      color:${BRAND}; font-size:10px; font-weight:600; letter-spacing:0.5px;
      text-transform:uppercase; padding:0 4px 0 9px; white-space:nowrap;
    }
    /* Blend the shared numeric input into the rows-field box (drop its own border/bg). */
    .pix-ss-rowsfield .pix-li-numinput { border:none !important; background:transparent !important; flex:1; border-radius:0; }
    .pix-ss-btn {
      flex:1; height:28px; border-radius:6px;
      border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05);
      color:rgba(255,255,255,0.85); font-weight:600; font-size:12px; letter-spacing:0.5px;
      cursor:pointer; transition:background .1s,border-color .1s,color .1s; font-family:inherit; padding:0;
    }
    .pix-ss-btn:hover { background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.35); color:#fff; }
    .pix-ss-btn.active { background:${BRAND}; color:#fff; border-color:${BRAND}; }
    .pix-ss-abtoggle { display:flex; gap:4px; width:96px; }
    .pix-ss-missingrow { align-items:center; }
    .pix-ss-missing-label { font-size:10px; color:#999; white-space:nowrap; }
    .pix-ss-missingtoggle { display:flex; gap:4px; flex:1; }
    .pix-ss-missingtoggle .pix-ss-btn { font-size:11px; letter-spacing:0; }
  `;
  document.head.appendChild(s);
}

function buildControls(node) {
  const root = document.createElement("div");
  root.className = "pix-ss-root";

  // Row 1: Rows field + A/B toggle.
  const row1 = document.createElement("div");
  row1.className = "pix-ss-row";

  const rowsField = document.createElement("div");
  rowsField.className = "pix-ss-rowsfield";
  const rowsLabel = document.createElement("span");
  rowsLabel.className = "pix-ss-rows-label";
  rowsLabel.textContent = "Rows";
  rowsField.appendChild(rowsLabel);

  const st0 = readState(node);
  const rowsBuilt = makeNumericInput({
    value: st0.rows,
    min: 1, max: MAX_ROWS, step: 1,
    format: (v) => String(Math.round(v)),
    onCommit: (v) => {
      let target = Math.max(1, Math.min(MAX_ROWS, Math.round(v)));
      const hw = highestWiredRow(node);
      if (target < hw) target = hw; // can't drop a wired row
      if (rowsBuilt.input.value !== String(target)) rowsBuilt.input.value = String(target);
      if (target !== rowCount(node)) rebuildSlots(node, target);
    },
  });
  rowsField.appendChild(rowsBuilt.wrap);
  row1.appendChild(rowsField);

  const ab = document.createElement("div");
  ab.className = "pix-ss-abtoggle";
  const btnA = document.createElement("button");
  btnA.className = "pix-ss-btn"; btnA.textContent = "A"; btnA.dataset.value = "A";
  const btnB = document.createElement("button");
  btnB.className = "pix-ss-btn"; btnB.textContent = "B"; btnB.dataset.value = "B";
  ab.append(btnA, btnB);
  row1.appendChild(ab);
  root.appendChild(row1);

  // Row 2: Missing-side mode toggle.
  const row2 = document.createElement("div");
  row2.className = "pix-ss-row pix-ss-missingrow";
  const mLabel = document.createElement("span");
  mLabel.className = "pix-ss-missing-label";
  mLabel.textContent = "Missing side";
  const mToggle = document.createElement("div");
  mToggle.className = "pix-ss-missingtoggle";
  const btnConn = document.createElement("button");
  btnConn.className = "pix-ss-btn"; btnConn.textContent = "Use connected"; btnConn.dataset.value = "connected";
  btnConn.title = "If a row's active side isn't wired, use whatever IS wired (e.g. one shared model on both A and B).";
  const btnStrict = document.createElement("button");
  btnStrict.className = "pix-ss-btn"; btnStrict.textContent = "Strict"; btnStrict.dataset.value = "strict";
  btnStrict.title = "Error if the active side of a wired row isn't connected (guarantees A means A).";
  mToggle.append(btnConn, btnStrict);
  row2.append(mLabel, mToggle);
  root.appendChild(row2);

  function refresh() {
    const s = readState(node);
    btnA.classList.toggle("active", s.active === "A");
    btnB.classList.toggle("active", s.active === "B");
    btnConn.classList.toggle("active", s.missing === "connected");
    btnStrict.classList.toggle("active", s.missing === "strict");
    if (rowsBuilt.input.value !== String(s.rows)) rowsBuilt.input.value = String(s.rows);
  }

  for (const b of [btnA, btnB]) {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const s = readState(node);
      s.active = b.dataset.value;
      writeState(node, s);
      refresh();
      updateOutputLabels(node);
      node.graph?.setDirtyCanvas?.(true, true);
    });
  }
  for (const b of [btnConn, btnStrict]) {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const s = readState(node);
      s.missing = b.dataset.value;
      writeState(node, s);
      refresh();
      node.graph?.setDirtyCanvas?.(true, true);
    });
  }

  refresh();
  return { root, refresh };
}

app.registerExtension({
  name: "Pixaroma.SwitchSource",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSwitchSource") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);
      const node = this;
      injectCSS();
      injectResizePanelCSS(); // styles the shared makeNumericInput (.pix-li-*)
      setupNode(node);        // strip raw Python slots -> initial rows
      const { root, refresh } = buildControls(node);
      node._pixSsRefresh = refresh;
      node.addDOMWidget("pixaroma_switch_source_ui", "custom", root, {
        canvasOnly: true, // Vue Compat #15 - keep out of the Parameters tab
        serialize: false,
        getMinHeight: () => CONTROL_BAND,
        getMaxHeight: () => CONTROL_BAND,
        getValue: () => null,
        setValue: () => {},
      });
      node.setDirtyCanvas(true, true);
      // Defer restore so node.properties is populated from workflow JSON first
      // (Vue Compat #8). onConfigure also restores (belt and braces).
      queueMicrotask(() => { restoreFromProperties(node); refresh(); });
    };

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      this._pixSsConfiguring = true;
      try {
        const r = _origConfigure?.apply(this, arguments);
        restoreFromProperties(this);
        this._pixSsRefresh?.();
        return r;
      } finally {
        this._pixSsConfiguring = false;
      }
    };

    // Wire connect/disconnect never changes the slot count (the Rows field
    // owns that). Just re-resolve output types/labels. Gated during rebuild /
    // configure / load so it never mutates serialized state on those paths.
    const _origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, slotIndex, isConnected, link, ioSlot) {
      if (!this._pixSsRebuilding && !this._pixSsConfiguring && !_ssLoadingGraph) {
        updateOutputLabels(this);
        this.graph?.setDirtyCanvas?.(true, true);
      }
      return _origConn?.apply(this, arguments);
    };

    // Click an output label to rename that row.
    const _origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      if (!this.flags?.collapsed) {
        const n = rowCount(this);
        for (let r = 1; r <= n; r++) {
          if (pointInRect(pos, outputLabelRect(this, r))) {
            openLabelEditor(this, r, outputLabelScreenRect(this, r));
            return true;
          }
        }
      }
      return _origDown ? _origDown.call(this, e, pos) : false;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      cancelEditorForNode(this);
      this._pixSsRefresh = null;
      return _origRemoved?.apply(this, arguments);
    };

    // Self-heal min width every paint (UI conventions #7; onResize unreliable
    // for DOM-widget nodes per Vue Compat #13).
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ────────────────────────────────
// Injects {version, active, rows, missing, aWired, bWired} into the hidden
// SwitchSourceState input AND prunes each row to the side actually used so only
// that branch executes.

function buildIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaSwitchSource" || n.type === "PixaromaSwitchSource") {
        index.set(String(n.id), n);
      }
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

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== "PixaromaSwitchSource") continue;
      if (!index) index = buildIndex();
      const node = findNode(index, id);
      if (!node) continue;

      const state = readState(node);
      const active = state.active;
      const missing = state.missing;
      const rows = rowCount(node);

      const aWired = [];
      const bWired = [];
      for (let r = 1; r <= rows; r++) {
        const a = (node.inputs || []).find((s) => s.name === `a_${r}`);
        const b = (node.inputs || []).find((s) => s.name === `b_${r}`);
        if (a && a.link != null) aWired.push(r);
        if (b && b.link != null) bWired.push(r);
      }

      entry.inputs = entry.inputs || {};
      // Prune each row to the side actually used so only that branch executes.
      for (let r = 1; r <= rows; r++) {
        const aw = aWired.includes(r);
        const bw = bWired.includes(r);
        let used;
        if (active === "A") used = aw ? "a" : (missing === "connected" && bw ? "b" : "a");
        else used = bw ? "b" : (missing === "connected" && aw ? "a" : "b");
        const drop = used === "a" ? `b_${r}` : `a_${r}`;
        if (drop in entry.inputs) delete entry.inputs[drop];
      }

      entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify({
        version: 1, active, rows, missing, aWired, bWired,
      });
    }
  }
  return result;
};
