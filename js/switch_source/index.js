import { app } from "/scripts/app.js";
import {
  STATE_PROP, MAX_ROWS, CONTROL_BAND,
  readState, writeState,
  setupNode, restoreFromProperties, rebuildSlots,
  updateOutputLabels, rowCount, highestWiredRow, minNodeHeight,
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

// Brief warning toast (modern ComfyUI API, with a hand-rolled banner fallback
// for older Easy Install builds that lack extensionManager.toast).
function toast(msg) {
  try {
    if (app.extensionManager?.toast?.add) {
      app.extensionManager.toast.add({ severity: "warn", summary: "Switch Source", detail: msg, life: 3000 });
      return;
    }
  } catch (e) { /* fall through to banner */ }
  const d = document.createElement("div");
  d.textContent = msg;
  d.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#1d1d1d;color:#fff;border:2px solid " + BRAND + ";border-radius:8px;padding:10px 16px;font:13px sans-serif;z-index:100000;box-shadow:0 4px 16px rgba(0,0,0,.5);";
  document.body.appendChild(d);
  setTimeout(() => { d.remove(); }, 3000);
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
    .pix-ss-rowsfield.is-blocked { border-color:#ff5555 !important; }
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
    /* Solid filled ▲▼ triangles (like Image Resize / Load Image), replacing the
       shared outline-chevron carets, and drop the internal divider so the Rows
       box reads as one uniform field. Literal glyphs - never the \\XXXX escape
       (octal-escape error in a template literal), per UI conventions #12. */
    .pix-ss-rowsfield .pix-li-spin { width:16px; border-left:none; }
    .pix-ss-rowsfield .pix-li-spin > button { background:transparent; }
    .pix-ss-rowsfield .pix-li-spin-up::before,
    .pix-ss-rowsfield .pix-li-spin-down::before {
      border:none; width:auto; height:auto; font-size:8px; line-height:1;
      transform:translate(-50%,-50%);
    }
    .pix-ss-rowsfield .pix-li-spin-up::before { content:"▲"; }
    .pix-ss-rowsfield .pix-li-spin-down::before { content:"▼"; }
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
  rowsField.title = "Number of A/B row pairs (1-16). Disconnect a row's wires before lowering Rows below it.";
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
      if (target < hw) {
        target = hw; // can't drop a wired row
        toast(`Can't go below ${hw} rows: row ${hw} still has wires. Disconnect them first.`);
        rowsField.classList.add("is-blocked");
        setTimeout(() => { rowsField.classList.remove("is-blocked"); }, 700);
      }
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
  btnA.title = "Route every row through its A input.";
  const btnB = document.createElement("button");
  btnB.className = "pix-ss-btn"; btnB.textContent = "B"; btnB.dataset.value = "B";
  btnB.title = "Route every row through its B input.";
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
  btnConn.title = "If a row's active side isn't wired, leave that output empty (no error). Use this when A and B have different numbers of wired rows.";
  const btnStrict = document.createElement("button");
  btnStrict.className = "pix-ss-btn"; btnStrict.textContent = "Strict"; btnStrict.dataset.value = "strict";
  btnStrict.title = "If a row's active side isn't wired but the OTHER side is, raise an error. Use this to catch wiring mistakes.";
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
        // Do NOT wipe slots here. onConfigure fires at the END of
        // LGraphNode.configure(), i.e. AFTER the saved slots and their links
        // have already been restored. The old clearAllSlots(this) was therefore
        // destroying every restored wire on every workflow load / tab switch /
        // undo (confirmed: the node came back with zero inputs/outputs and the
        // whole graph lost its links). The saved two-bank order is preserved
        // because setupNode leaves the node empty during a load, so configure
        // re-adds the saved slots in their saved order.
        const r = _origConfigure?.apply(this, arguments);
        // Set the safety-net flag AFTER _origConfigure SUCCEEDS. If it threw,
        // the flag stays false and setupNode's microtask falls through to its
        // slot-count check + buildBareRows fallback (recovering an empty node
        // from saved state.rows), instead of being permanently disabled.
        this._pixSsConfigureRan = true;
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

    // Self-heal min width AND height every paint (UI conventions #7; onResize
    // unreliable for DOM-widget nodes per Vue Compat #13). Without the height
    // floor, dragging the node shorter clips the control strip / output rows
    // past the bottom frame. Both writes are CONDITIONAL (only when below the
    // min) so a correctly-saved workflow never gets a size write on load
    // (Vue Compat #18).
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      const minH = minNodeHeight(rowCount(this));
      if (this.size[1] < minH) this.size[1] = minH;
    };

    // Belt-and-braces clamp on the resize path too (Switch WH pattern).
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        const minH = minNodeHeight(rowCount(this));
        if (size[1] < minH) size[1] = minH;
      }
      return _origResize?.apply(this, arguments);
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
      // ACTIVE SIDE ONLY: always prune the inactive side, regardless of mode.
      // The mode (use-connected vs strict) only affects Python's behaviour
      // when the active side is empty - it never causes a fallback to the
      // other side. aWired/bWired travel with the state so strict mode can
      // tell whether the OTHER side was wired (i.e. the user probably meant
      // to use the other bank and should see an error).
      for (let r = 1; r <= rows; r++) {
        const drop = active === "A" ? `b_${r}` : `a_${r}`;
        if (drop in entry.inputs) delete entry.inputs[drop];
      }

      entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify({
        version: 1, active, rows, missing, aWired, bWired,
      });
    }
  }
  return result;
};
