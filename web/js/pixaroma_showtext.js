import { app } from "/scripts/app.js";

// ─── constants ────────────────────────────────────────────────────────────────
const MARGIN = 10; // left/right gap between node edge and text box
const PAD_H = 8; // horizontal text padding inside the box
const PAD_V = 8; // vertical text padding inside the box
const LINE_H = 20; // px per text line
const BOX_TOP = 28; // Y where the text box starts (below the single input slot)

function boxHeight(lines) {
  return Math.max(32, lines.length * LINE_H + PAD_V * 2);
}

// ─── extension ────────────────────────────────────────────────────────────────
app.registerExtension({
  name: "Pixaroma.ShowText",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaShowText") return;

    // ── created ─────────────────────────────────────────────────────────
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated
        ? onNodeCreated.apply(this, arguments)
        : undefined;
      this._pixText = "";
      // Set a compact initial size until first execution
      this.size[0] = Math.max(this.size[0] || 220, 220);
      this.size[1] = BOX_TOP + boxHeight([""]) + 6;
      return r;
    };

    // ── executed (called by ComfyUI after the node runs) ─────────────────
    nodeType.prototype.onExecuted = function (output) {
      this._pixText = (output.text || []).join("\n");
      const lines = this._pixText.split("\n");
      this.size[1] = BOX_TOP + boxHeight(lines) + 6;
      app.graph.setDirtyCanvas(true, true);
    };

    // ── draw the text box on the LiteGraph canvas ────────────────────────
    const onDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (onDrawForeground) onDrawForeground.call(this, ctx);

      // Show a dim placeholder before first run
      const text =
        this._pixText !== undefined && this._pixText !== null
          ? String(this._pixText)
          : "";
      const lines = text.split("\n");
      const bW = this.size[0] - MARGIN * 2;
      const bH = boxHeight(lines);

      ctx.save();

      // Rounded background box
      ctx.fillStyle = "#161616";
      ctx.strokeStyle = "#2e2e2e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(MARGIN, BOX_TOP, bW, bH, 4);
      } else {
        ctx.rect(MARGIN, BOX_TOP, bW, bH);
      }
      ctx.fill();
      ctx.stroke();

      // Clip so long text never bleeds outside the box
      ctx.beginPath();
      ctx.rect(MARGIN + 2, BOX_TOP + 2, bW - 4, bH - 4);
      ctx.clip();

      // Text
      ctx.fillStyle = text ? "#c8c8c8" : "#555";
      ctx.font = "13px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const displayLines = text ? lines : ["not executed yet"];
      displayLines.forEach((line, i) => {
        ctx.fillText(line, MARGIN + PAD_H, BOX_TOP + PAD_V + i * LINE_H);
      });

      ctx.restore();
    };

    // add min resize while resizing
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (e) {
      if (_origResize) return _origResize.call(this, e);
      this.size[0] = Math.max(this.size[0], 200);
      this.size[1] = Math.max(this.size[1], 80);
    };
  },
});
