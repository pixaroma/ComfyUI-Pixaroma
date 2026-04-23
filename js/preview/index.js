import { app } from "/scripts/app.js";
import { BRAND } from "../shared/utils.mjs";

// ---- button geometry ----
const BTN_W = 120;
const BTN_H = 24;
const BTN_GAP = 8;
const BTN_MARGIN_BOTTOM = 6;

// ---- colors (mirror Compare's paintBtn) ----
const COLOR_ACTIVE_FILL = BRAND;
const COLOR_ACTIVE_FILL_HOVER = "#ff8a5e";
const COLOR_ACTIVE_STROKE = BRAND;
const COLOR_ACTIVE_TEXT = "#fff";
const COLOR_DISABLED_FILL = "#2a2c2e";
const COLOR_DISABLED_STROKE = "#444";
const COLOR_DISABLED_TEXT = "#999";

// ---- button model ----
function getButtonRects(node) {
  const nodeW = node.size[0];
  const nodeH = node.size[1];
  const totalW = BTN_W * 2 + BTN_GAP;
  const x0 = Math.max(6, (nodeW - totalW) / 2);
  const y = nodeH - BTN_H - BTN_MARGIN_BOTTOM;
  return [
    { id: "disk",   x: x0,                     y, w: BTN_W, h: BTN_H, label: "Save to Disk" },
    { id: "output", x: x0 + BTN_W + BTN_GAP,   y, w: BTN_W, h: BTN_H, label: "Save to Output" },
  ];
}

function paintBtn(ctx, rect, active, hovered) {
  const { x, y, w, h, label } = rect;
  ctx.save();
  ctx.fillStyle = active
    ? (hovered ? COLOR_ACTIVE_FILL_HOVER : COLOR_ACTIVE_FILL)
    : COLOR_DISABLED_FILL;
  ctx.strokeStyle = active ? COLOR_ACTIVE_STROKE : COLOR_DISABLED_STROKE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = active ? COLOR_ACTIVE_TEXT : COLOR_DISABLED_TEXT;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

// ---- extension ----
app.registerExtension({
  name: "Pixaroma.Preview",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPreview") return;

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.apply(this, arguments);
      if (this.flags?.collapsed) return;

      const active = !!(this.imgs && this.imgs.length > 0);
      const rects = getButtonRects(this);
      const hoverId = this._pixaromaHoverId || null;
      for (const r of rects) {
        paintBtn(ctx, r, active, hoverId === r.id);
      }
    };
  },
});
