// Image Info Pixaroma - the companion that unpacks Load Image Mini's image_info
// bundle into image / mask / width / height / filename.
//
// The node itself is plain (one input, five outputs), so its height is just the
// five output rows. The width / height / filename readout is painted in the
// LEFT dead-space beside those rows (Classic renderer) - deliberately NOT a body
// widget, so the node never grows taller than its outputs (the user's explicit
// request). The values come from the node's own `executed` payload. Nodes 2.0
// skips node-body painting, so there the node is clean I/O with no readout;
// either way all five outputs are correct.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isVueNodes } from "../shared/nodes2.mjs";

const CLASS = "PixaromaImageInfo";
const MIN_W = 190;
const DEFAULT_W = 216;

// Slot geometry (CLAUDE.md Vue Compat #16): row i centre = TOP_PAD + i*SLOT_H +
// SLOT_H/2. The single input (image_info) sits at row 0 on the LEFT, so the
// readout starts below it and the output labels are right-aligned on the RIGHT.
const TOP_PAD = 4;
const SLOT_H = 20;
const RIGHT_RESERVE = 108;   // room for the right-aligned output labels
const FAM = "ui-sans-serif, system-ui, sans-serif";

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function paintReadout(node, ctx) {
  if (node.flags?.collapsed) return;
  const x = 10;
  const maxW = node.size[0] - x - RIGHT_RESERVE;
  if (maxW < 44) return; // too narrow to say anything useful

  const data = node._pixInfoData;
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  if (!data) {
    // No run yet. A wired-but-not-run node can only report once it executes.
    const wired = (node.inputs?.[0]?.link != null);
    ctx.font = `11px ${FAM}`;
    ctx.fillStyle = "#6a6a6a";
    ctx.fillText(ellipsize(ctx, wired ? "Run to read info" : "Wire image_info in", maxW),
      x, TOP_PAD + 2 * SLOT_H + SLOT_H / 2);
    ctx.restore();
    return;
  }

  // Line 1: dimensions. Line 2: filename. Centred across rows 2-3 of the body.
  const y1 = TOP_PAD + 2 * SLOT_H + SLOT_H / 2;
  const y2 = y1 + SLOT_H;
  ctx.font = `bold 12px ${FAM}`;
  ctx.fillStyle = "#dcdce0";
  ctx.fillText(ellipsize(ctx, `${data.width} × ${data.height}`, maxW), x, y1);
  ctx.font = `11px ${FAM}`;
  ctx.fillStyle = "#9a9aa2";
  ctx.fillText(ellipsize(ctx, data.filename || "(no name)", maxW), x, y2);
  ctx.restore();
}

app.registerExtension({
  name: "Pixaroma.ImageInfo",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixInfoPatched) return;
    nodeType.prototype._pixInfoPatched = true;

    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      if (!isVueNodes() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _origResize?.apply(this, arguments);
    };

    // Legacy: paint the readout in the left dead-space. Nodes 2.0 skips node-body
    // painting entirely (the readout is a Classic-renderer nicety; the node still
    // outputs everything correctly there).
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origDraw?.apply(this, arguments);
      if (isVueNodes()) return r;
      if (this.size[0] < MIN_W) { this.size[0] = MIN_W; this.setDirtyCanvas(true, true); }
      paintReadout(this, ctx);
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS) return;
    // A compact default width so the readout and the output labels fit side by
    // side. Synchronous so configure() overrides for saved workflows.
    if (!node.size || node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
  },
});

// One app-level `executed` listener: stash the width/height/filename this node
// reported so the face can paint them. Hot-reload guarded.
if (!app._pixInfoExecPatched) {
  app._pixInfoExecPatched = true;
  api.addEventListener("executed", ({ detail }) => {
    try {
      const entry = detail?.output?.pixaroma_image_info?.[0];
      if (!entry) return;
      const graph = app.graph;
      // Exact lookup handles string AND numeric ids (getNodeById keys by
      // string-coerced id). Only fall back to parseInt for a plain numeric id,
      // NOT a subgraph exec id like "5:12" (parseInt would resolve node 5).
      const rawId = detail.node;
      let node = graph?.getNodeById?.(rawId);
      if (!node && !String(rawId).includes(":")) node = graph?.getNodeById?.(parseInt(rawId, 10));
      if (!node || node.comfyClass !== CLASS) return;
      node._pixInfoData = { width: entry.width, height: entry.height, filename: entry.filename };
      node.setDirtyCanvas?.(true, true);
    } catch (e) {
      console.warn("[Image Info Pixaroma] readout failed:", (e && e.message) || e);
    }
  });
}
