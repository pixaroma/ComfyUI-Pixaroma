// Seamless Preview Pixaroma - the face: the picture repeated the way the `view`
// dropdown says, a PASS / WARN / FAIL chip per direction (from Python's seam check),
// a pager when a batch came in, and a Lines switch that marks where each tile starts.
//
// One DOM widget fills the body in both renderers (nodes2-preview-fill.md): the root
// gets flex:1 1 0 + min-height:0, all layout lives on an absolute INNER layer that
// ComfyUI never restyles, getMinHeight + computeLayoutSize carry the floor, no
// computeSize. The repeat is CSS background layers (views.mjs), so there is no canvas
// to snapshot or to re-render on zoom. The last run's result is kept on
// node.properties.pixSeamless so a reload or a tab switch shows it again.

import { app } from "../../../scripts/app.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { capComputeSizeInNodes2, growToCoreMinHeight } from "../shared/core_min_size.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { runTab, eachRestoredOutput } from "../shared/run_tab.mjs";
import { registerNodeAccent, installNodeAccent, ACC } from "../shared/node_settings.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { SEAMLESS_PREVIEW_HELP } from "./help.mjs";
import { VIEWS, viewLayout, fitTile, layerCss } from "./views.mjs";

const CLASS = "SeamlessPreviewPixaroma";
const PROP = "pixSeamless";          // { entries: [...], more: n }  (the last run)
const GUIDES_PROP = "pixSeamLines";  // true = draw the tile lines
const MIN_W = 264;                   // the batch bar (chips + arrows + Lines) needs 242 px of the 244 this leaves
const DEFAULT_W = 340;
const DEFAULT_H = 430;
const FACE_MIN_H = 150;              // bar 22 + gap 6 + a picture you can still read
const STATUS = {
  PASS: { cls: "is-pass", tip: "joins like any other line in the picture" },
  WARN: { cls: "is-warn", tip: "the edge is the strongest line, but only a little: look at it in Offset" },
  FAIL: { cls: "is-fail", tip: "a real seam: the edge stands out from every other line" },
  "N/A": { cls: "", tip: "the picture is too small to check, or its pixels are broken (NaN, often a black picture from a failed run)" },
};

registerNodeHelp(CLASS, SEAMLESS_PREVIEW_HELP);
registerNodeAccent(CLASS, { title: "Seamless Preview", onChange: (node) => render(node) });

function injectCSS() {
  if (document.getElementById("pix-seamp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-seamp-css";
  s.textContent = `
.pix-seamp-inner { position:absolute; inset:0; display:flex; flex-direction:column; gap:6px;
  container-type:inline-size; }
.pix-seamp-bar { flex:0 0 22px; display:flex; align-items:center; gap:6px; min-width:0; overflow:hidden; }
.pix-seamp-chip { flex:0 0 auto; height:22px; box-sizing:border-box; padding:0 8px; border-radius:4px;
  display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; line-height:1;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.15); color:#aaa; user-select:none;
  white-space:nowrap; }
.pix-seamp-chip .pix-seamp-dir { font-weight:400; color:rgba(255,255,255,.75); }
.pix-seamp-chip.is-pass { color:#3ec371; border-color:rgba(62,195,113,.55); }
.pix-seamp-chip.is-warn { color:#e8b04a; border-color:rgba(232,176,74,.6); }
.pix-seamp-chip.is-fail { color:#ff6b5e; border-color:rgba(255,107,94,.65); }
.pix-seamp-note { flex:1 1 auto; min-width:0; font-size:11px; color:rgba(255,255,255,.6); overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; user-select:none; }
.pix-seamp-spacer { flex:1 1 auto; }
.pix-seamp-btn { flex:0 0 auto; height:22px; min-width:24px; box-sizing:border-box; padding:0 7px;
  border-radius:4px; border:1px solid #444; background:#1d1d1d; color:#aaa; font:inherit; font-size:11px;
  cursor:pointer; user-select:none; display:inline-flex; align-items:center; justify-content:center; }
.pix-seamp-btn:hover { border-color:${ACC}; color:#ddd; }
.pix-seamp-btn.is-on { background:${ACC}; border-color:${ACC}; color:#fff; }
.pix-seamp-btn:disabled { opacity:.4; cursor:default; }
.pix-seamp-btn:disabled:hover { border-color:#444; color:#aaa; }
.pix-seamp-btn:focus-visible { outline-offset:-2px; }
.pix-seamp-count { flex:0 0 auto; font-size:11px; color:#aaa; min-width:34px; text-align:center; user-select:none; }
.pix-seamp-area { position:relative; flex:1 1 0; min-height:0; overflow:hidden; border-radius:4px;
  background:rgba(0,0,0,.25); }
.pix-seamp-stage { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); }
.pix-seamp-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  padding:12px; box-sizing:border-box; text-align:center; font-size:11px; line-height:1.4;
  color:rgba(255,255,255,.55); user-select:none; }
/* the narrow-width rules come LAST: an @container block adds no specificity, so a base rule after it would win */
@container (max-width: 300px) {
  .pix-seamp-bar { gap:4px; }
  .pix-seamp-bar .pix-seamp-count { display:none !important; }
  .pix-seamp-chip { padding:0 5px; }
}
@container (max-width: 240px) {
  .pix-seamp-bar .pix-seamp-paged { display:none !important; }
}
`;
  document.head.appendChild(s);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function viewOf(node) {
  const v = node.widgets?.find((w) => w.name === "view")?.value;
  return VIEWS.includes(v) ? v : "2x2";
}

function entriesOf(node) {
  const d = node.properties?.[PROP];
  return Array.isArray(d?.entries) ? d.entries : [];
}

function pct(x) { return `${Math.round(x * 100)} %`; }

function chipTip(dirWords, seam) {
  const st = STATUS[seam?.status] || STATUS["N/A"];
  let t = `${dirWords}: ${seam?.status || "N/A"}, ${st.tip}.`;
  if (seam && seam.ratio != null) {
    t += `\nThe jump across the edge is ${seam.ratio.toFixed(2)} times a normal line`
      + `${seam.rank != null ? `; ${pct(seam.rank)} of the lines inside the picture are stronger` : ""}.`;
  }
  return t;
}

function buildFace(node) {
  const root = el("div", "pix-seamp-root");
  root.style.cssText = "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;";
  const inner = el("div", "pix-seamp-inner");
  const bar = el("div", "pix-seamp-bar");
  const chipLR = el("span", "pix-seamp-chip");
  const chipUD = el("span", "pix-seamp-chip");
  const note = el("span", "pix-seamp-note", "Run to check the edges");
  const spacer = el("span", "pix-seamp-spacer");
  // Narrow faces drop the "1 / 4" count, narrower ones the arrows too (CSS
  // container queries above), so the bar never runs past the node's side.
  const prev = el("button", "pix-seamp-btn pix-seamp-paged", "‹");
  const count = el("span", "pix-seamp-count");
  const next = el("button", "pix-seamp-btn pix-seamp-paged", "›");
  const lines = el("button", "pix-seamp-btn", "Lines");
  prev.setAttribute("aria-label", "Previous picture");
  next.setAttribute("aria-label", "Next picture");
  prev.title = "Previous picture";
  next.title = "Next picture";
  lines.title = "Show where each tile starts. Off is best for judging the seam by eye.";
  for (const b of [prev, next, lines]) b.type = "button";
  bar.append(chipLR, chipUD, note, spacer, prev, count, next, lines);
  const area = el("div", "pix-seamp-area");
  const stage = el("div", "pix-seamp-stage");
  stage.setAttribute("role", "img");
  const empty = el("div", "pix-seamp-empty", "Run to see the pattern repeat.");
  area.append(stage, empty);
  inner.append(bar, area);
  root.append(inner);

  // Buttons act on pointerdown-free click; stop the canvas from treating them as a drag.
  for (const b of [prev, next, lines]) b.addEventListener("pointerdown", (e) => e.stopPropagation());
  prev.addEventListener("click", () => { node._pixSeamIdx = (node._pixSeamIdx || 0) - 1; render(node); });
  next.addEventListener("click", () => { node._pixSeamIdx = (node._pixSeamIdx || 0) + 1; render(node); });
  lines.addEventListener("click", () => {
    node.properties = node.properties || {};
    if (node.properties[GUIDES_PROP]) delete node.properties[GUIDES_PROP];
    else node.properties[GUIDES_PROP] = true;
    render(node);
  });

  node._pixSeamUI = { root, chipLR, chipUD, note, prev, count, next, lines, area, stage, empty };
  return root;
}

function setChip(chip, label, dirWords, seam) {
  const st = STATUS[seam?.status] || STATUS["N/A"];
  chip.className = `pix-seamp-chip ${st.cls}`;
  chip.replaceChildren(el("span", "pix-seamp-dir", label), document.createTextNode(seam?.status || "N/A"));
  chip.title = chipTip(dirWords, seam);
  chip.setAttribute("aria-label", chip.title);
}

function render(node) {
  const ui = node._pixSeamUI;
  if (!ui) return;
  const entries = entriesOf(node);
  const n = entries.length;
  const idx = n ? Math.min(Math.max(0, node._pixSeamIdx || 0), n - 1) : 0;
  node._pixSeamIdx = idx;
  const e = entries[idx];
  const more = node.properties?.[PROP]?.more || 0;

  ui.chipLR.style.display = e ? "" : "none";
  ui.chipUD.style.display = e ? "" : "none";
  ui.note.style.display = e ? "none" : "";
  if (e) {
    setChip(ui.chipLR, "↔", "Left and right edges", e.seam?.left_right);
    setChip(ui.chipUD, "↕", "Top and bottom edges", e.seam?.up_down);
  }
  const paged = n > 1;
  for (const b of [ui.prev, ui.count, ui.next]) b.style.display = paged ? "" : "none";
  ui.count.textContent = paged ? `${idx + 1} / ${n}` : "";
  ui.count.title = more ? `${more} more in the batch are not shown here (the tiled output has all of them).` : "";
  ui.prev.disabled = idx <= 0;
  ui.next.disabled = idx >= n - 1;
  const guides = !!node.properties?.[GUIDES_PROP];
  ui.lines.classList.toggle("is-on", guides);
  ui.lines.setAttribute("aria-pressed", guides ? "true" : "false");

  const view = viewOf(node);
  ui.stage.setAttribute("aria-label", e ? `The picture shown as ${view}` : "No picture yet");
  if (!e || !e.filename) {
    ui.stage.style.display = "none";
    ui.empty.style.display = "";
    ui.empty.textContent = "Run to see the pattern repeat.";
    return;
  }
  const route = `/view?filename=${encodeURIComponent(e.filename)}&type=${encodeURIComponent(e.type || "temp")}`
    + `&subfolder=${encodeURIComponent(e.subfolder || "")}`;
  const url = pixApiUrl(route);
  const layout = viewLayout(view);
  const fit = fitTile(ui.area.clientWidth, ui.area.clientHeight, e.width, e.height, layout.cols, layout.rows);
  if (!fit) return;             // not laid out yet: the ResizeObserver calls again
  Object.assign(ui.stage.style, {
    display: "", width: `${fit.w}px`, height: `${fit.h}px`,
    ...layerCss(url, layout, fit, guides, `color-mix(in srgb, ${ACC} 85%, transparent)`),
  });
  // A missing file (ComfyUI restarted, temp folder cleared) says so instead of a blank box.
  if (ui.checkedUrl !== url) {
    ui.checkedUrl = url;
    ui.empty.style.display = "none";
    const probe = new Image();
    probe.onerror = () => {
      if (ui.checkedUrl !== url) return;
      ui.stage.style.display = "none";
      ui.empty.style.display = "";
      ui.empty.textContent = "The preview file is gone (ComfyUI was restarted). Run again to see it.";
    };
    probe.src = url;
  }
}

// Keep the last run on the node (idempotent: a cached Run re-sends the same result,
// and an unchanged result must not mark the workflow modified).
function applyOutput(node, output) {
  const entries = output?.pixaroma_seamless;
  if (!Array.isArray(entries)) return;
  const data = { entries, more: output?.pixaroma_seamless_more?.[0] || 0 };
  node.properties = node.properties || {};
  if (JSON.stringify(node.properties[PROP]) !== JSON.stringify(data)) {
    node.properties[PROP] = data;
    node._pixSeamIdx = 0;
  }
  render(node);
}

app.registerExtension({
  name: "Pixaroma.SeamlessPreview",

  // A Run that ended while another workflow tab was open (js/shared/run_tab.mjs).
  onNodeOutputsUpdated(nodeOutputs) {
    eachRestoredOutput(nodeOutputs, CLASS, (node, output) => applyOutput(node, output));
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixSeamPatched) return;
    nodeType.prototype._pixSeamPatched = true;
    capComputeSizeInNodes2(nodeType);

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      injectCSS();
      const node = this;
      const bornInLoad = isGraphLoading();
      this.hideOutputImages = true;
      const root = buildFace(node);
      installCanvasZoomPassthrough(root);
      const widget = this.addDOMWidget("pixaroma_seamless_view", "pixaroma_seamless_view", root,
        { serialize: false, hideOnZoom: false, getMinHeight: () => FACE_MIN_H });
      widget.serialize = false;
      applyAdaptiveCanvasOnly(widget);
      widget.computeLayoutSize = () => ({ minHeight: FACE_MIN_H, minWidth: 1 });
      installNodeAccent(this, root);

      // Redraw when the view changes (the dropdown's own callback; a load / undo
      // comes through onConfigure below).
      const vw = this.widgets?.find((w) => w.name === "view");
      if (vw && !vw._pixSeamWrapped) {
        vw._pixSeamWrapped = true;
        const cb = vw.callback;
        vw.callback = function () {
          const out = cb?.apply(this, arguments);
          render(node);
          return out;
        };
      }

      // Fresh drop only: a comfortable start, at least core's own height (VC#28).
      if (!bornInLoad) {
        if (!this.size || this.size[0] < DEFAULT_W) this.size = [DEFAULT_W, this.size?.[1] || DEFAULT_H];
        if (this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;
        if (!isVueNodes()) growToCoreMinHeight(this);
      }
      queueMicrotask(() => render(node));
      return r;
    };

    // The ResizeObserver and the Nodes 2.0 drag floor (a window listener) only for a
    // node that really joins a graph. Every Ctrl+C builds a throwaway clone() that runs
    // onNodeCreated and never gets onRemoved; installing them there left 3 window
    // listeners per copy (measured: 15 after 5 copies). A clone is never added.
    const onAdded = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function () {
      const r = onAdded?.apply(this, arguments);
      const node = this;
      const ui = node._pixSeamUI;
      if (ui && !node._pixSeamRO) {
        node._pixSeamRO = new ResizeObserver(() => render(node));
        node._pixSeamRO.observe(ui.area);
        // Nodes 2.0 floors a corner drag by a live measurement, not computeLayoutSize:
        // pin the face's floor for the length of the drag only (no-op in Classic).
        node._pixSeamFloorOff = installResizeFloor(ui.root, () => FACE_MIN_H);
      }
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const node = this;
      queueMicrotask(() => render(node));
      return r;
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return onResize?.apply(this, arguments);
    };

    // Core calls this on the right node, also inside a subgraph (an app-level
    // `executed` listener gets the id "<subgraph>:<node>" and missed it, measured).
    // A Run that ended while another tab is open belongs to that tab (VC#30).
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      const r = onExecuted?.apply(this, arguments);
      const node = this;
      queueMicrotask(() => {
        try {
          if (runTab(output) === "other") return;
          applyOutput(node, output);
        } catch (e) {
          console.warn("[Seamless Preview Pixaroma] preview failed:", (e && e.message) || e);
        }
      });
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixSeamRO?.disconnect();
      this._pixSeamRO = null;
      this._pixSeamFloorOff?.();
      this._pixSeamFloorOff = null;
      return onRemoved?.apply(this, arguments);
    };
  },
});
