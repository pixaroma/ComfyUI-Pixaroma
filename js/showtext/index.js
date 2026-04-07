import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";
// ─── constants ────────────────────────────────────────────────────────────────
const MARGIN = 10; // left/right gap between node edge and text box
const PAD_H = 8; // horizontal text padding inside the box
const PAD_V = 8; // vertical text padding inside the box
const LINE_H = 16; // px per text line
const BOX_TOP = 28; // Y where the text box starts (below the single input slot)

function boxHeight(lines) {
  // Minimum 1 line height when empty, grows with content
  return Math.max(LINE_H, lines.length * LINE_H) + PAD_V * 2;
}

function computeNodeHeight(ctx, text, nodeWidth) {
  const maxWidth = nodeWidth - MARGIN * 2 - PAD_H * 2;
  const displayLines = text ? wrapText(ctx, text, maxWidth) : ["text..."];
  return BOX_TOP + boxHeight(displayLines) + 10;
}

function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const lines = text.split("\n");
  const wrappedLines = [];

  ctx.font = "13px monospace";

  for (const line of lines) {
    const words = line.split(" ");
    let currentLine = words[0] || "";

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + " " + word;
      if (ctx.measureText(testLine).width > maxWidth) {
        wrappedLines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    wrappedLines.push(currentLine);
  }
  return wrappedLines;
}

// ─── extension ────────────────────────────────────────────────────────────────
app.registerExtension({
  name: "Pixaroma.ShowText",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaShowText") return;

    nodeType.prototype.onNodeCreated = function () {
      this._pixText = "";
      this._displayLines = [];
      this.size = [220, BOX_TOP + boxHeight([""]) + 10];
    };

    nodeType.prototype.onExecuted = function (output) {
      this._pixText = (output.text || []).join("\n");
      const tempCtx = document.createElement("canvas").getContext("2d");
      this.size[1] = computeNodeHeight(tempCtx, this._pixText, this.size[0]);
      app.graph.setDirtyCanvas(true, true);
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      if (this.collapsed) return;

      const text =
        this._pixText !== undefined && this._pixText !== null
          ? String(this._pixText)
          : "";
      const bW = this.size[0] - MARGIN * 2;
      const maxWidth = bW - PAD_H * 2;

      this._displayLines = text
        ? wrapText(ctx, text, maxWidth)
        : ["text..."];

      const minHeight = boxHeight(this._displayLines);
      const bH = Math.max(minHeight, this.size[1] - BOX_TOP - 10);

      // Ensure size matches content
      const desiredHeight = computeNodeHeight(ctx, text, this.size[0]);
      if (this.size[1] < desiredHeight) {
        this.size[1] = desiredHeight;
      }

      ctx.save();
      // Background
      ctx.fillStyle = "#111" || BRAND + "10";
      ctx.strokeStyle = BRAND;
      ctx.lineWidth = 1.5;

      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(MARGIN, BOX_TOP, bW, bH, 4);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(MARGIN, BOX_TOP, bW, bH);
        ctx.strokeRect(MARGIN, BOX_TOP, bW, bH);
      }

      // Text Style
      ctx.fillStyle = text ? "#c8c8c8" : "#666";
      ctx.font = "13px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const TEXT_OFFSET_Y = 2; // increase to move text down
      this._displayLines.forEach((line, i) => {
        ctx.fillText(line, MARGIN + PAD_H, BOX_TOP + PAD_V + i * LINE_H + TEXT_OFFSET_Y);
      });

      ctx.restore();
    };

    // add min resize while resizing
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (e) {
      if (_origResize) return _origResize.call(this, e);
      this.size[0] = Math.max(this.size[0], 200);
      const minNodeHeight = BOX_TOP + boxHeight(this._displayLines || []) + 10;
      this.size[1] = Math.max(this.size[1], minNodeHeight);
    };
  },
});
