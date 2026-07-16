// Outpaint Pixaroma - the node face: mode, ratio, add-space and limit rows.
// One DOM widget, both renderers. The maths lives in core.mjs (mirroring
// nodes/node_outpaint.py); this file only paints it and collects clicks.
//
// State lives on node.properties.outpaintState and is injected into the hidden
// OutpaintState input by the graphToPrompt hook at the bottom (Vue Compat #9),
// so nothing here needs a visible widget or an input dot.
//
// The chevron, the gear and the colour swatch are rendered at their final
// geometry but are deliberately INERT: the settings panel is a later task and a
// button that opens nothing would be a lie. They carry the "dim" class until
// then so they read as not-yet-live rather than broken.

import { app } from "/scripts/app.js";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  BRAND, DEFAULT_RATIOS, DEFAULT_STATE, LIMITS, STATE_PROP,
  anchorAxis, readState, remapAnchor, writeState,
} from "./core.mjs";

const CLASS = "PixaromaOutpaint";
const HIDDEN_INPUT = "OutpaintState"; // must match node_outpaint.py's hidden input

const DEFAULT_W = 322; // fits 6 ratio chips on one line; also the practical minimum
const MIN_W = 322;

// Height maths. These mirror the CSS below - keep them in lockstep.
const PAD = 9;      // .pix-op-inner padding, top + bottom
const ROW_GAP = 6;  // gap between rows
const FLOOR_FALLBACK = 148; // four rows, used only while the root is unmounted
const FLOOR_MIN = 60;
const FLOOR_CAP = 260;

// ── source size ────────────────────────────────────────────────────────────
// The dimensions of the wired image, or null when they are not known yet
// (nothing wired, or the upstream image has not finished loading). Task 4's
// preview brings a fuller resolver; this reads the upstream node directly,
// which is enough for the rows and matches what Text Overlay does.
function sourceSize(node) {
  try {
    const slot = (node.inputs || []).find((i) => i && i.name === "image");
    if (!slot || slot.link == null) return null;
    const graph = node.graph || app.graph;
    // graph.links can be a Map in newer frontends (Vue Compat #3).
    let link = graph?.links?.[slot.link];
    if (!link && typeof graph?.links?.get === "function") link = graph.links.get(slot.link);
    if (!link) return null;
    const img = graph.getNodeById?.(link.origin_id)?.imgs?.[0];
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { w: img.naturalWidth, h: img.naturalHeight };
    }
  } catch (_e) { /* an unresolved wire is not an error, just an unknown size */ }
  return null;
}

// The upstream image arrives asynchronously and there is no per-frame tick to
// notice it (Vue Compat #1), so a freshly opened workflow would paint its rows
// against an unknown source and never correct itself. Poll briefly, only while a
// link exists with no size yet, and stop the moment the size lands.
function pollSource(node) {
  clearInterval(node._pixOpPoll);
  node._pixOpPoll = null;
  if (sourceSize(node)) return;
  let ticks = 0;
  node._pixOpPoll = setInterval(() => {
    const size = sourceSize(node);
    if (node.graph && !size && ++ticks <= 30) return;
    clearInterval(node._pixOpPoll);
    node._pixOpPoll = null;
    if (node.graph && size) renderFace(node);
  }, 100);
}

// ── CSS ────────────────────────────────────────────────────────────────────
// No backticks anywhere inside this string (one would end the literal early and
// silently disable the whole extension), and no CSS unicode escapes (they are
// illegal octal escapes in a template literal) - the glyphs are set from JS.
function injectCSS() {
  if (document.getElementById("pixaroma-outpaint-css")) return;
  const css = `
    .pix-op-root { position:relative; width:100%; height:100%; box-sizing:border-box;
      background:#1d1d1d; border-radius:4px; color:#ddd;
      font-family: ui-sans-serif, system-ui, sans-serif; font-size:11px; }
    /* The flex column lives HERE, never on the root: ComfyUI forces the root to
       inline display:block on every rebuild and collapse, which would kill it. */
    .pix-op-inner { position:absolute; inset:0; box-sizing:border-box;
      display:flex; flex-direction:column; gap:${ROW_GAP}px; padding:${PAD}px;
      user-select:none; }
    .pix-op-row { display:flex; align-items:stretch; gap:5px; flex:0 0 auto;
      flex-wrap:wrap; }

    /* Chips: idle / hover / active per node UI convention #13. Hover moves the
       border and brightens the text - a fill would read as "active". */
    .pix-op-chip { flex:1 1 auto; min-width:0; box-sizing:border-box;
      display:flex; align-items:center; justify-content:center;
      padding:6px 4px; border-radius:5px;
      background:#1d1d1d; border:1px solid #444; color:#aaa;
      cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      transition:background .08s, border-color .08s, color .08s; }
    .pix-op-chip:hover { border-color:var(--pix-op-acc,${BRAND}); color:#ddd; }
    .pix-op-chip.on { background:var(--pix-op-acc,${BRAND});
      border-color:var(--pix-op-acc,${BRAND}); color:#fff; }
    /* Nothing to click: no pointer, no hover promise. */
    .pix-op-chip.dim { opacity:.4; cursor:default; }
    .pix-op-chip.dim:hover { border-color:#444; color:#aaa; }
    .pix-op-chip.dim.on:hover { border-color:var(--pix-op-acc,${BRAND}); color:#fff; }

    /* Chevron and gear: fixed, so the mode chips get every spare pixel. */
    .pix-op-sq { flex:0 0 auto; width:26px; padding:6px 0; }
    .pix-op-alabel { flex:0 0 auto; display:flex; align-items:center;
      color:#8a8a8a; padding-right:1px; white-space:nowrap; }

    /* A readout of the fill colour, not a button (its picker is a later task). */
    .pix-op-swatch { flex:0 0 auto; width:26px; border-radius:5px;
      border:1px solid #444; cursor:default; }
  `;
  const s = document.createElement("style");
  s.id = "pixaroma-outpaint-css";
  s.textContent = css;
  document.head.appendChild(s);
}

// ── row builders ───────────────────────────────────────────────────────────
function chip(text, on, title) {
  const el = document.createElement("div");
  el.className = "pix-op-chip" + (on ? " on" : "");
  el.textContent = text;
  if (title) el.title = title;
  return el;
}

function row(host) {
  const el = document.createElement("div");
  el.className = "pix-op-row";
  host.appendChild(el);
  return el;
}

function apply(node, patch) {
  writeState(node, patch);
  renderFace(node);
  node.setDirtyCanvas?.(true, true);
}

function renderModeRow(node, host) {
  const st = readState(node);

  const chevron = chip("▾", false);
  chevron.classList.add("pix-op-sq", "dim"); // wired in the fold task
  host.appendChild(chevron);

  for (const [value, text, tip] of [
    ["ratio", "To ratio", "Grow the image to a target shape"],
    ["sides", "By side", "Add an exact number of pixels per edge"],
  ]) {
    const c = chip(text, st.mode === value, tip);
    c.onclick = () => apply(node, { mode: value });
    host.appendChild(c);
  }

  const gear = chip("⚙", false);
  gear.classList.add("pix-op-sq", "dim"); // wired in the settings task
  host.appendChild(gear);
}

function renderRatioRow(node, host) {
  const st = readState(node);
  // st.ratios is written by the settings task; fall back until it exists.
  const ratios = Array.isArray(st.ratios) && st.ratios.length ? st.ratios : DEFAULT_RATIOS;
  for (const r of ratios) {
    const c = chip(r, st.ratio === r, "Grow the image to " + r);
    c.onclick = () => apply(node, { ratio: r });
    host.appendChild(c);
  }
}

function renderAnchorRow(node, host) {
  const st = readState(node);
  const src = sourceSize(node);

  // By side mode: the per-edge numbers already say where everything goes, so an
  // anchor here would be a second, conflicting way to say the same thing.
  host.style.display = st.mode === "ratio" ? "" : "none";
  if (st.mode !== "ratio") return;

  // null covers two different things, and they must not be confused:
  //   src === null      -> the source size is unknown (nothing wired yet)
  //   axis === null     -> the source is known and this ratio grows nothing
  const axis = src ? anchorAxis(st.ratio, src.w, src.h) : null;
  const grows = !!axis;
  const shown = axis || "h"; // unknown source: show the horizontal triplet

  // "Both", not "Centre": the middle option splits the new space across both
  // sides, and "add space in the centre" would read as adding it in the middle
  // of the picture.
  const labels = shown === "v"
    ? [["top", "Top"], ["middle", "Both"], ["bottom", "Bottom"]]
    : [["left", "Left"], ["centre", "Both"], ["right", "Right"]];

  // Persist the remap so a 3:2 -> 9:16 flip keeps "hug the far edge" rather than
  // silently resetting to centre. Only when the live axis is genuinely KNOWN: an
  // unwired node shows the horizontal triplet as a placeholder, and remapping a
  // stored vertical anchor against that guess would corrupt it. Never on the
  // load path (Vue Compat #18) - the poll above can fire past the load window.
  const live = grows ? remapAnchor(st.anchor, axis) : st.anchor;
  if (live !== st.anchor && !isGraphLoading()) writeState(node, { anchor: live });

  // What the row HIGHLIGHTS, always in the shown triplet's vocabulary so a
  // stored cross-axis anchor still lights a chip. Display only, never written.
  const sel = remapAnchor(live, shown);

  const lbl = document.createElement("span");
  lbl.className = "pix-op-alabel";
  lbl.textContent = "Add space"; // NOT "Anchor" - see padsForRatio's comment
  host.appendChild(lbl);

  for (const [value, text] of labels) {
    const c = chip(text, sel === value);
    if (!grows) {
      c.classList.add("dim");
      c.title = src
        ? "This ratio matches the image, so there is nothing to add"
        : "Wire an image in to choose which side the new space goes on";
    } else {
      c.title = value === "centre" || value === "middle"
        ? "Split the new space evenly across both sides"
        : "Put the new space on the " + text.toLowerCase();
      c.onclick = () => apply(node, { anchor: value });
    }
    host.appendChild(c);
  }
}

function renderLimitRow(node, host) {
  const st = readState(node);
  for (const v of LIMITS) {
    const text = v === 0 ? "Off" : (v === 1 ? "1 MP" : String(v));
    const c = chip(text, st.limit === v, v === 0
      ? "Keep the padded size"
      : "Scale the padded image to " + v + " megapixels");
    c.onclick = () => apply(node, { limit: v });
    host.appendChild(c);
  }
  const sw = document.createElement("div");
  sw.className = "pix-op-swatch";
  sw.style.background = st.color;
  sw.title = "Fill colour: " + st.color;
  host.appendChild(sw);
}

function renderFace(node) {
  const ui = node._pixOpUI;
  if (!ui) return;
  const inner = ui.inner;
  inner.style.setProperty("--pix-op-acc", BRAND); // the settings task makes this per-node
  inner.innerHTML = "";
  renderModeRow(node, row(inner));
  renderRatioRow(node, row(inner));
  renderAnchorRow(node, row(inner));
  renderLimitRow(node, row(inner));
}

// ── height ─────────────────────────────────────────────────────────────────
// Sum the laid-out rows. REFUSE to measure an unmounted or zero-width root: the
// rows would wrap against no width and the sum would explode, inflating the node
// permanently. The 4px rounding stops font jitter creeping it taller on every
// workflow open (Vue Compat #18).
function measureFloor(node) {
  const ui = node._pixOpUI;
  if (!ui || !ui.root.isConnected || ui.root.clientWidth === 0) {
    return ui?._floorCache ?? FLOOR_FALLBACK;
  }
  let h = 0;
  let shown = 0;
  for (const child of ui.inner.children) {
    if (child.style.display === "none") continue; // the anchor row in By side mode
    h += child.offsetHeight;
    shown++;
  }
  if (!shown) return ui._floorCache ?? FLOOR_FALLBACK;
  h += (shown - 1) * ROW_GAP + PAD * 2;
  ui._floorCache = Math.min(Math.max(Math.round(h / 4) * 4, FLOOR_MIN), FLOOR_CAP);
  return ui._floorCache;
}

// ComfyUI's loadGraphData runs a fit pass over EVERY node: size = max(saved,
// computeSize()). A node saved shorter than its own computeSize therefore grows
// on the next open, which flags a clean workflow as modified (Vue Compat #18).
// This node is born short because the two ComfyUI size paths disagree: the live
// _arrangeWidgets settles it at slots+widget, while computeSize adds a slightly
// larger chrome estimate (measured: 214 vs 226). So mirror the load pass once at
// birth and the height we save is already the height the load will produce.
// FRESH nodes only - configure() owns a loaded node's size.
function snapFresh(node, tries = 0) {
  requestAnimationFrame(() => {
    if (!node.graph || node._pixOpConfigured || isGraphLoading()) return;
    const ui = node._pixOpUI;
    // computeSize is only trustworthy once the widget has a width: measureFloor
    // refuses to guess before that. Give layout a few frames, then snap anyway
    // (a node dropped off-screen never gets one).
    if ((!ui || !ui.root.isConnected || ui.root.clientWidth === 0) && tries < 20) {
      snapFresh(node, tries + 1);
      return;
    }
    const want = node.computeSize?.()?.[1];
    if (want > 0 && node.size[1] < want - 1) {
      node.setSize?.([node.size[0], want]);
      node.setDirtyCanvas?.(true, true);
    }
  });
}

// ── setup ──────────────────────────────────────────────────────────────────
function setupNode(node) {
  const root = document.createElement("div");
  root.className = "pix-op-root";
  const inner = document.createElement("div");
  inner.className = "pix-op-inner";
  root.appendChild(inner);
  node._pixOpUI = { root, inner, _floorCache: FLOOR_FALLBACK };

  // No custom computeSize and no getMaxHeight: either makes the widget
  // fixed-height in legacy, so the node grows but can never shrink. minWidth 1
  // or the saved node width will not round-trip.
  const w = node.addDOMWidget("outpaint_ui", "pixaroma_outpaint", root, {
    serialize: false,
    getMinHeight: () => measureFloor(node),
  });
  w.computeLayoutSize = () => ({ minHeight: measureFloor(node), minWidth: 1 });
  applyAdaptiveCanvasOnly(w);

  // Fresh nodes only, and SYNCHRONOUS: configure() runs after onNodeCreated and
  // restores a loaded node's saved width over this. A microtask would run after
  // configure() instead and clobber the user's size.
  if (node.size[0] < MIN_W) node.size[0] = DEFAULT_W;

  // Defer the first paint past configure() so a restored workflow renders its
  // saved state, not the defaults (Vue Compat #8).
  queueMicrotask(() => {
    renderFace(node);
    pollSource(node);
    snapFresh(node);
  });
}

app.registerExtension({
  name: "Pixaroma.Outpaint",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixOpPatched) return; // hot-reload guard
    nodeType.prototype._pixOpPatched = true;

    injectCSS();

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      // This node came from a saved workflow, so its size is already settled:
      // snapFresh must keep its hands off it.
      this._pixOpConfigured = true;
      const r = _origConfigure?.apply(this, arguments);
      // Paint only - renderFace touches no serialized state, and the anchor
      // remap inside it is gated on isGraphLoading().
      if (this._pixOpUI) { renderFace(this); pollSource(this); }
      return r;
    };

    const _origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index, connected, link, ioSlot) {
      const r = _origConn?.apply(this, arguments);
      // The wired image decides which triplet the Add space row shows, so repaint
      // on any wire change. Safe to run during the load replay (Vue Compat #19):
      // this only paints, and the remap write is gated on isGraphLoading().
      if (this._pixOpUI) { renderFace(this); pollSource(this); }
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      clearInterval(this._pixOpPoll);
      this._pixOpPoll = null;
      return _origRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS) return;
    setupNode(node);
  },
});

// ── graphToPrompt: inject the per-node state ────────────────────────────────
// INJECT ONLY - never prune here: Export (API) serialises this same output, so a
// prune would strip the exported workflow.
function buildIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

if (!app._pixOpPromptPatched) {
  app._pixOpPromptPatched = true;
  const _origGraphToPrompt = app.graphToPrompt.bind(app);
  app.graphToPrompt = async function (...args) {
    const result = await _origGraphToPrompt(...args);
    try {
      const out = result?.output;
      if (out) {
        let index = null;
        for (const id in out) {
          const entry = out[id];
          if (!entry || entry.class_type !== CLASS) continue;
          if (!index) index = buildIndex();
          const node = findNode(index, id);
          const state = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
          entry.inputs = entry.inputs || {};
          entry.inputs[HIDDEN_INPUT] = state;
        }
      }
    } catch (e) {
      console.warn("[Outpaint Pixaroma] could not inject state:", (e && e.message) || e);
    }
    return result;
  };
}
