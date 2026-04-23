import { app } from "/scripts/app.js";
import { BRAND } from "../shared/utils.mjs";

const BTN_W = 120;
const BTN_H = 24;
const BTN_GAP = 8;
const BTN_MARGIN_BOTTOM = 6;

const COLOR_ACTIVE_FILL = BRAND;
const COLOR_ACTIVE_FILL_HOVER = "#ff8a5e";
const COLOR_ACTIVE_STROKE = BRAND;
const COLOR_ACTIVE_TEXT = "#fff";
const COLOR_DISABLED_FILL = "#2a2c2e";
const COLOR_DISABLED_STROKE = "#444";
const COLOR_DISABLED_TEXT = "#999";

const TOAST_MS = 2000;

// ---- geometry ----
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

function hitTest(rect, lx, ly) {
  return lx >= rect.x && lx <= rect.x + rect.w && ly >= rect.y && ly <= rect.y + rect.h;
}

// ---- paint ----
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

function paintToast(ctx, node, text) {
  const rects = getButtonRects(node);
  const y = rects[0].y;
  const x = rects[0].x;
  const w = rects[1].x + rects[1].w - x;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.strokeStyle = BRAND;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, BTN_H, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + BTN_H / 2 + 1);
  ctx.restore();
}

function showToast(node, text) {
  node._pixaromaToast = { text, until: Date.now() + TOAST_MS };
  node.setDirtyCanvas(true, true);
  setTimeout(() => {
    const t = node._pixaromaToast;
    if (t && t.until <= Date.now()) {
      node._pixaromaToast = null;
      node.setDirtyCanvas(true, true);
    }
  }, TOAST_MS + 100);
}

// ---- blob / data URI helpers ----
async function getPreviewBlob(node) {
  const img = node.imgs?.[0];
  if (!img || !img.src) return null;
  const resp = await fetch(img.src);
  if (!resp.ok) throw new Error(`preview fetch failed: ${resp.status}`);
  return await resp.blob();
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

async function getWorkflowAndPrompt() {
  // app.graphToPrompt() returns { workflow, output }; "output" is the prompt.
  const { workflow, output } = await app.graphToPrompt();
  return { workflow, prompt: output };
}

function readFilenamePrefix(node) {
  const w = node.widgets?.find((x) => x.name === "filename_prefix");
  const v = (w?.value ?? "Preview").toString().trim();
  return v || "Preview";
}

// ---- save handlers ----
async function saveToOutput(node) {
  if (!node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
  try {
    const blob = await getPreviewBlob(node);
    if (!blob) throw new Error("no preview blob");
    const dataURL = await blobToDataURL(blob);
    const { workflow, prompt } = await getWorkflowAndPrompt();
    const resp = await fetch("/pixaroma/api/preview/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: dataURL,
        filename_prefix: readFilenamePrefix(node),
        workflow,
        prompt,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showToast(node, `Save failed: ${data.error || resp.status}`);
      return;
    }
    showToast(node, `Saved: ${data.filename}`);
  } catch (err) {
    showToast(node, `Save failed: ${err.message || err}`);
  }
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

      const rects = getButtonRects(this);
      const active = !!(this.imgs && this.imgs.length > 0);
      const hoverId = this._pixaromaHoverId || null;
      for (const r of rects) paintBtn(ctx, r, active, hoverId === r.id);

      const toast = this._pixaromaToast;
      if (toast && toast.until > Date.now()) {
        paintToast(ctx, this, toast.text);
      }
    };

    const origMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, localPos) {
      if (this.flags?.collapsed) {
        return origMouseDown ? origMouseDown.apply(this, arguments) : false;
      }
      const rects = getButtonRects(this);
      for (const r of rects) {
        if (hitTest(r, localPos[0], localPos[1])) {
          if (r.id === "output") saveToOutput(this);
          // disk handler wired in Task 8
          return true;
        }
      }
      return origMouseDown ? origMouseDown.apply(this, arguments) : false;
    };
  },
});
