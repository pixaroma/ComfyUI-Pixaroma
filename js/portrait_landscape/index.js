import { app } from "/scripts/app.js";
import { applyAdaptiveCanvasOnly, isVueNodes, installResizeFloor,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { installNodeAccent, registerNodeSettings, ACC } from "../shared/node_settings.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import {
  STATE_PROP, HIDDEN_INPUT_NAME, MULTIPLES, DEFAULT_STATE,
  readState, writeState, nextMultiple, multipleLabel, previewSize,
} from "./state.mjs";
import { openPortraitPanel, closePortraitPanelFor } from "./settings.mjs";

// Portrait Landscape Pixaroma - two pill buttons (Portrait | Landscape) that
// choose the orientation of the width/height the node outputs. The node's
// width/height are native INT widgets (type a value OR wire one in); the
// Portrait/Landscape choice lives on node.properties.portraitLandscapeState
// and is injected into the hidden PortraitLandscapeState input by the
// app.graphToPrompt hook below (Switch WH / Resolution pattern, Vue Compat #9).

const BRAND = "#f66744";

// The top row's own height, and how much of its right edge belongs to the
// output labels. Derived the same way Duration's was, by measuring the drawn
// node rather than guessing: with LiteGraph's 14px node font "height" is the
// wider of the two labels, and the content edge lands at
// nodeW - 16 - LABEL_RESERVE. See .claude/patterns/duration.md #14.
// The row spans the WHOLE band (one 20px slot row per output, two outputs), not
// just the first. At 22px it covered "width" and left the native width field
// sitting on top of "height", hiding it. Being transparent and pointer-through,
// covering the band costs nothing: both labels and both dots show through and
// stay clickable, and only the little button and gear are opaque.
const SLOT_BAND = 40;
const TOPROW_H = SLOT_BAND;
const LABEL_RESERVE = 62;

// How far the band floats UP from the top of the pills widget to reach the
// output-slot band, in Classic. A constant for this node's fixed layout (two
// number fields between the slots and the pills).
//
// MEASURED, not guessed: on a fresh node the widget root starts at node-local
// y=98 and the two output dots sit at y=14 and y=34, so the band has to start
// at y=4 for its 20px button to centre on the first dot row and its 40px height
// to cover both. 4 - 98 = -94. Re-measure the same way (getConnectionPos for the
// dots, getBoundingClientRect for the root) if a widget is ever added or removed
// between the slots and the pill row.
const CLASSIC_BAND_TOP = -94;

// Left inset for the band's controls so they line up with the width/height
// fields underneath. LiteGraph draws a native number widget inset further than
// the DOM widget root is, so the band needs its own (larger) padding.
const BAND_INSET = 11;

const BTN_H = 30;
const PAD = 6;
const GAP = 6;
const WIDGET_H = BTN_H + PAD * 2;

// Fresh-drop WIDTH (CLAUDE.md UI conventions #5) - wide enough that the two
// pills don't crowd. The HEIGHT is auto-fit to the content (title + the two
// number fields + the pill row) via node.computeSize(), so there's no empty
// gap under the pills and no over-tall default.
const DEFAULT_W = 240;
const MIN_W = 240;

function injectCSS() {
  if (document.getElementById("pix-portrait-landscape-css")) return;
  const style = document.createElement("style");
  style.id = "pix-portrait-landscape-css";
  style.textContent = `
    .pix-pl-root {
      display: flex;
      gap: ${GAP}px;
      padding: ${PAD}px;
      box-sizing: border-box;
      width: 100%;
      align-items: stretch;
    }
    .pix-pl-btn {
      flex: 1;
      min-width: 0;
      height: ${BTN_H}px;
      border-radius: 6px;
      /* Semi-transparent white overlay (not fixed dark grey) so the inactive
         button adapts when the user recolours the node via right-click ->
         Colors. Matches Switch WH / Text Pixaroma button style. */
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.85);
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.3px;
      cursor: pointer;
      transition: background 0.1s, border-color 0.1s, color 0.1s;
      font-family: inherit;
      padding: 0 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pix-pl-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.35);
      color: #fff;
    }
    .pix-pl-btn.active {
      background: var(--pix-acc,#f66744);
      color: #fff;
      border-color: var(--pix-acc,#f66744);
    }

    /* The top row lives IN the output-slot band, so it reserves the right for
       the "width" / "height" labels the node paints there. Transparent, or it
       would cover them. Classic only - Nodes 2.0 draws the dots in their own
       block and has no band to reclaim. */
    /* The widget root is the positioning context for the floated band. */
    .pix-pl-outer { position: relative; display: flex; flex-direction: column; }

    .pix-pl-toprow {
      display: flex; align-items: flex-start; justify-content: flex-start; gap: 5px;
      box-sizing: border-box; height: ${TOPROW_H}px;
      /* BAND_INSET, not PAD: LiteGraph insets a native number widget further
         than the DOM widget root is inset, so at PAD the button sat ~5px left of
         the width field below it and the edges did not line up. */
      padding: 0 0 0 ${BAND_INSET}px; background: transparent; user-select: none;
      /* The band lies OVER both output rows. Transparent to the pointer so the
         real dots underneath stay hoverable and wireable; the two controls put
         it back for themselves. */
      pointer-events: none;
    }
    /* CLASSIC: float the band UP out of the widget flow into the empty slot
       band between the dots. Nothing between the .dom-widget wrapper and the
       viewport clips upward, so this works; Nodes 2.0 DOES clip above the
       widget top, which is why it keeps the plain in-flow row instead. */
    .pix-pl-toprow.classic {
      position: absolute; left: 0; right: 0; top: ${CLASSIC_BAND_TOP}px;
    }
    /* NODES 2.0: parked inside the output-slot block, so it simply fills it -
       no offset to measure and nothing to re-tune if the slot count changes. */
    .pix-pl-toprow.parked {
      position: absolute; inset: 0; height: auto; align-items: center;
      padding-left: ${BAND_INSET}px;
    }
    .pix-pl-toprow > * { pointer-events: auto; }
    /* ComfyUI wraps every DOM widget in its own div, and THAT is what was
       swallowing clicks meant for the output dots underneath - making the row
       transparent is not enough on its own. A descendant with pointer-events
       back on still receives them, so the button and gear are unaffected.
       !important is required, not stylistic: ComfyUI writes pointer-events:auto
       as an INLINE style on that wrapper, and an inline style beats any
       stylesheet rule without it. Verified by reading parent.style.pointerEvents
       while the rule was already matching. */
    .dom-widget:has(> .pix-pl-toprow) { pointer-events: none !important; }
    .pix-pl-toprow.classic { padding-right: ${LABEL_RESERVE}px; }
    .pix-pl-step {
      flex: none; min-width: 42px; box-sizing: border-box; height: 20px;
      border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 11px;
      padding: 0 7px; line-height: 1;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.7);
    }
    .pix-pl-step:hover { border-color: ${ACC}; color: #ddd; }
    .pix-pl-step.on, .pix-pl-step.on:hover {
      background: ${ACC}; border-color: ${ACC}; color: #fff;
    }
    /* The bundled gear SVG as a mask, never the emoji: an emoji is drawn by the
       OS, so it is a different shape and baseline on every platform. */
    /* Same 20px box as the button beside it, with the icon centred inside, so
       the two share a centre line. At 16px it was top-aligned to a 20px button
       and read as sitting high. */
    .pix-pl-gear {
      flex: none; width: 20px; height: 20px; padding: 0; margin: 0;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; cursor: pointer;
    }
    .pix-pl-gear::before {
      content: ""; display: block; width: 14px; height: 14px; background: #bbb;
      -webkit-mask: url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask: url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    }
    .pix-pl-gear:hover::before { background: ${ACC}; }
    /* The size the node will actually send. Sits after the gear, in the space
       left over before the output labels, and ellipsises rather than pushing
       into them on a narrow node. */
    .pix-pl-preview {
      flex: 0 1 auto; min-width: 0; height: 20px; line-height: 20px;
      font-size: 11px; color: ${ACC}; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .pix-pl-preview.dim { color: rgba(255,255,255,0.4); font-style: italic; }
  `;
  document.head.appendChild(style);
}

// Orientation only, for the two pills. The size step is read straight from
// readState where it is needed.
function readOrient(node) {
  return readState(node).orient;
}

function writeOrient(node, orient) {
  writeState(node, { orient });
}

// ── the top row: the gear and the size-step button ─────────────────────────
// It sits IN the output-slot band. Classic stacks one 20px row per output above
// the widgets, and the two labels are right-aligned, so the left of that 40px
// band is dead space - the same trick Duration uses. The row reserves the right
// for the "width" / "height" labels.
// Pull the widgets up over Classic's output-slot band. Not serialized (it is
// litegraph's own field for custom slot layouts) and Classic-only: Nodes 2.0
// renders the dots in their own block, so there is no band to reclaim and the
// row simply sits at the top of the body as normal.
// Classic floats the band up into the slot dead-space; Nodes 2.0 clips anything
// above the widget top, so there it stays a plain row above the pills. Re-run
// whenever the renderer might have changed. DOM only - it writes no node state,
// so it can never dirty a saved workflow.
// ── where the band lives, per renderer ──────────────────────────────────────
// CLASSIC: float it up out of the widget flow into the slot dead-space.
// NODES 2.0: Vue clips anything above the widget top, so the float is no use -
// instead PARK the band inside the output-slot block itself. That block is the
// dead-space, so the band lands exactly on it with no measuring at all, and it
// keeps the node as short as the Classic one instead of adding a row at the
// bottom. Same family as the Load Image Mini nudge, but simpler: Mini pulls the
// block out of flow so its FIRST widget rises into the band, which would put
// this node's width field there rather than the button.
//
// DOM only, wrapped in try/catch: if a future frontend defeats it the band falls
// back to a plain row and the node still works.
function vueSlotBlock(el) {
  return el?.querySelector(".lg-slot--output")?.parentElement?.parentElement || null;
}

function parkBandInSlots(node) {
  if (!isVueNodes()) return;
  try {
    const band = node._pixPlTopRow;
    if (!band) return;
    const el = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
    const block = vueSlotBlock(el);
    if (!block) return;
    if (band.parentElement === block) return;   // steady state, no work
    block.style.position = "relative";
    block.appendChild(band);
    band.classList.add("parked");
  } catch { /* band stays a row in the body; the node still works */ }
}

function applyBandPlacement(node) {
  const classic = !isVueNodes();
  const band = node._pixPlTopRow;
  if (!band) return;
  band.classList.toggle("classic", classic);
  if (classic) {
    // Coming back from Nodes 2.0 the band is still parked in the slot block,
    // which does not exist in Classic - put it back at the top of our own root.
    band.classList.remove("parked");
    const root = node._pixPlRoot;
    if (root && band.parentElement !== root) root.insertBefore(band, root.firstChild);
  } else {
    parkBandInSlots(node);
  }
}

// Vue REPLACES the node element on re-render, which orphans the parked band, and
// it can add the slots a frame late. A self-heal poll is required (the Load Image
// Mini lesson); the parent check above makes the steady state one comparison.
function watchBandPark(node) {
  if (node._pixPlParkPoll) return;
  node._pixPlParkPoll = setInterval(() => {
    if (!node.graph) { clearInterval(node._pixPlParkPoll); node._pixPlParkPoll = null; return; }
    if (isVueNodes()) parkBandInSlots(node);
  }, 350);
  requestAnimationFrame(() => parkBandInSlots(node));
  setTimeout(() => parkBandInSlots(node), 150);
}

// Switching renderer fires no hook we can hang off, and the two placements are
// NOT interchangeable: the Classic float is clipped by the Nodes 2.0 node body,
// so a node built in Classic lost its band entirely after the toggle (verified
// live). Watch the flag instead. One boolean compare a second, only while such a
// node is on the canvas, and it stops when the last one goes.
let _rendererWatch = 0;
let _lastVue = null;
function watchRenderer() {
  if (_rendererWatch) return;
  _lastVue = isVueNodes();
  _rendererWatch = setInterval(() => {
    const nodes = (app.graph?._nodes || app.graph?.nodes || [])
      .filter((n) => n.comfyClass === "PixaromaPortraitLandscape");
    if (!nodes.length) { clearInterval(_rendererWatch); _rendererWatch = 0; return; }
    const now = isVueNodes();
    if (now === _lastVue) return;
    _lastVue = now;
    for (const n of nodes) { applyBandPlacement(n); n._pixPlRefresh?.(); }
  }, 1000);
}

function buildTopRow(node) {
  const row = document.createElement("div");
  row.className = "pix-pl-toprow";

  const step = document.createElement("button");
  step.className = "pix-pl-step";

  const gear = document.createElement("button");
  gear.className = "pix-pl-gear";
  gear.title = "Portrait Landscape settings";
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    openPortraitPanel(node, (n) => { n._pixPlRefresh?.(); n.setDirtyCanvas?.(true, true); });
  });

  step.addEventListener("click", (e) => {
    e.stopPropagation();
    writeState(node, { multiple: nextMultiple(readState(node).multiple) });
    refresh();
    node.graph?.setDirtyCanvas?.(true, true);
  });

  // What will actually go out, so a change is visible before you run.
  const prev = document.createElement("span");
  prev.className = "pix-pl-preview";

  function refresh() {
    const m = readState(node).multiple;
    step.textContent = multipleLabel(m);
    step.classList.toggle("on", m > 0);
    step.title = m > 0
      ? `Sizes are rounded to the nearest ${m} pixels. Click for the next step.`
      : "Sizes go out exactly as typed. Click to round them to 8, 16, 32 or 64.";
    const p = previewSize(node);
    prev.textContent = p.text;
    prev.classList.toggle("dim", p.wired);
    prev.title = p.wired
      ? "A size is coming from a wire, so it is only known when you run."
      : `This node will send ${p.text}`;
  }

  row.append(step, gear, prev);
  refresh();
  return { row, refresh };
}

function buildRoot(node) {
  const root = document.createElement("div");
  root.className = "pix-pl-outer";
  const pills = document.createElement("div");
  pills.className = "pix-pl-root";

  const btnP = document.createElement("button");
  btnP.className = "pix-pl-btn";
  btnP.textContent = "Portrait";
  btnP.title = "Tall: the smaller number becomes the width";
  btnP.dataset.value = "portrait";

  const btnL = document.createElement("button");
  btnL.className = "pix-pl-btn";
  btnL.textContent = "Landscape";
  btnL.title = "Wide: the larger number becomes the width";
  btnL.dataset.value = "landscape";

  pills.appendChild(btnP);
  pills.appendChild(btnL);
  // The band goes FIRST in the DOM so that when it is NOT floated (Nodes 2.0,
  // which clips anything above the widget top) it simply sits above the pills.
  const top = buildTopRow(node);
  root.append(top.row, pills);
  node._pixPlTopRow = top.row;
  node._pixPlTopRefresh = top.refresh;

  function refresh() {
    const s = readOrient(node);
    btnP.classList.toggle("active", s === "portrait");
    btnL.classList.toggle("active", s === "landscape");
  }

  for (const b of [btnP, btnL]) {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeOrient(node, b.dataset.value);
      // The WHOLE face, not just the pills: the preview in the band shows the
      // orientation applied, so refreshing only these two left it showing the
      // portrait size after clicking Landscape.
      (node._pixPlRefresh || refresh)();
      node.graph?.setDirtyCanvas?.(true, true);
    });
  }

  refresh();
  return { root, refresh };
}

function setupNode(node) {
  injectCSS();
  const { root, refresh } = buildRoot(node);
  node._pixPlRoot = root;
  // Both faces have to repaint: the pills show the orientation, the band the
  // size step, and the settings panel can change either.
  node._pixPlRefresh = () => { refresh(); node._pixPlTopRefresh?.(); };

  // The band is a CHILD of the pills root, NOT a widget of its own.
  //
  // Adding a widget BEFORE the native width/height ones corrupts saved
  // workflows, and it is worth writing down why: LGraphNode.serialize writes
  // `widgets_values[n]` using the FULL widget index and simply skips a
  // serialize:false widget, which leaves a HOLE; configure reads the array
  // SEQUENTIALLY, skipping those same widgets. Save and load therefore disagree
  // the moment a non-serializing widget sits in front of a serializing one.
  // Measured: a node saved with [null,900,1300,""] reloaded as width=null,
  // height=900. So the band floats out of the flow instead (the LoRA Loader
  // technique) and the widget list is left exactly as it was.
  // The preview has to follow the two NATIVE number widgets as well as our own
  // controls, so wrap their callbacks. Wrapping (not replacing) keeps whatever
  // ComfyUI already had on them.
  for (const name of ["width", "height"]) {
    const w = node.widgets?.find((x) => x.name === name);
    if (!w || w._pixPlWrapped) continue;
    w._pixPlWrapped = true;
    const orig = w.callback;
    w.callback = function (...args) {
      const r = orig?.apply(this, args);
      node._pixPlRefresh?.();
      return r;
    };
  }

  applyBandPlacement(node);
  watchBandPark(node);
  watchRenderer();

  const measureHeight = () => WIDGET_H;

  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);   // the face follows this node's accent colour
  const _plWidget = node.addDOMWidget("pixaroma_portrait_landscape_ui", "pixaroma_portrait_landscape", root, {
    // canvasOnly set adaptively below (CLAUDE.md Nodes 2.0): true in legacy
    // (out of the Parameters tab), false in Nodes 2.0 (renders in Vue body).
    getValue: () => null,
    setValue: () => {},
    getMinHeight: measureHeight,
    getMaxHeight: measureHeight,
    margin: 4,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(_plWidget);

  // Nodes 2.0 drag floor: pin the pill row's min-height ONLY while a resize
  // handle is dragged so it can't be dragged out of the node frame (the Vue
  // renderer's drag floor is a live DOM measurement, not getMinHeight). No-op
  // in legacy. Uninstalled in onRemoved.
  node._pixPlFloorOff = installResizeFloor(root, () => WIDGET_H);

  // Fresh-drop size: width = DEFAULT_W, height = LiteGraph's natural content
  // height (title + the two number fields + the pill row) so the node hugs its
  // content with no empty gap. configure() runs AFTER nodeCreated (Vue Compat
  // #8) and overwrites both on workflow restore + duplicate, so existing
  // workflows keep their saved size; only fresh drops use this. Mutate the
  // array rather than replacing it (plays nicer with any reactive proxy).
  const snugH = node.computeSize()[1];
  node.size[0] = DEFAULT_W;
  node.size[1] = snugH;
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "Pixaroma.PortraitLandscape",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPortraitLandscape") return;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      // Defer so node.properties is settled before we read it. The lift is
      // re-asserted because a saved node arrives without widgets_start_y.
      // DOM only - nothing here may write node.size or an untouched workflow
      // opens flagged "modified" (Vue Compat #18).
      applyBandPlacement(this);
      queueMicrotask(() => { applyBandPlacement(this); this._pixPlRefresh?.(); });
      watchRenderer();
      return r;
    };

    // Clamp manual resize WIDTH so the two pills never clip past the right
    // edge. Height is left to LiteGraph (its content-based min floors it, so
    // the node can't be dragged shorter than the pills + fields, and there's
    // no forced empty space). LEGACY-ONLY: in Nodes 2.0 the rendered size
    // lives in the Vue layout store, so clamping node.size there desyncs and
    // makes the node jump on a workflow switch (CLAUDE.md "Nodes 2.0
    // manual-resize MINIMUM").
    const _origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      }
      if (_origOnResize) return _origOnResize.apply(this, arguments);
    };

    // Self-heal min size on every paint (Preview Image Pattern #11 + UI
    // conventions #7), catching resize paths that bypass onResize (Vue
    // Compat #13). Also legacy-only for the reason above.
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (isVueNodes()) return;
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };

    // Wiring a size in (or unplugging it) changes what the preview can honestly
    // say, so repaint. DOM ONLY - it writes no serialized state, so it needs no
    // isGraphLoading guard and cannot flag a workflow modified (Vue Compat #19).
    const _origConnChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _origConnChange?.apply(this, arguments);
      queueMicrotask(() => this._pixPlRefresh?.());
      return r;
    };

    const _origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPlFloorOff?.();
      this._pixPlFloorOff = null;
      if (this._pixPlParkPoll) { clearInterval(this._pixPlParkPoll); this._pixPlParkPoll = null; }
      closePortraitPanelFor(this);
      this._pixPlTopRow = null;
      return _origOnRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaPortraitLandscape") return;
    setupNode(node);
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ──────────────────────────────
// Same walk-and-inject pattern as Switch WH / Resolution Pixaroma. Required
// because PortraitLandscapeState is `hidden` (no widget) so the workflow JSON
// doesn't carry it; we inject from node.properties at submission time.

function buildPixaromaNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaPortraitLandscape" || n.type === "PixaromaPortraitLandscape") {
        index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findPixaromaNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  // FAIL OPEN - see the note in pause_image: a throw here rejects ComfyUI's
  // own graphToPrompt and breaks Run for the whole workflow. Never wrap the
  // `await _origGraphToPrompt` above; a failure in CORE must propagate.
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== "PixaromaPortraitLandscape") continue;
        if (!index) index = buildPixaromaNodeIndex();
        const node = findPixaromaNode(index, id);
        // JSON now that there is a size step as well as an orientation. Python's
        // parse_state still accepts the bare legacy string, so a workflow saved
        // before this existed keeps working until it is re-saved.
        const st = node ? readState(node) : { ...DEFAULT_STATE };
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(st);
      }
    }
  } catch (e) {
    console.error("[Pixaroma] Portrait Landscape prompt injection failed; prompt sent unchanged", e);
  }
  return result;
};

// The colour option: a right-click "Portrait Landscape settings" entry, the gear in the
// selection toolbar, and the shared colour panel behind both.
// Its own panel (the size step is PER NODE, which a shared settings row cannot
// express), so it registers as a custom settings host. The colour option is
// still offered inside that panel via createAccentSection.
registerNodeSettings("PixaromaPortraitLandscape", {
  title: "Portrait Landscape",
  ownMenuItem: false,
  open: (node) => openPortraitPanel(node, (n) => {
    n._pixPlRefresh?.();
    n.setDirtyCanvas?.(true, true);
  }),
  closeFor: (node) => closePortraitPanelFor(node),
});
