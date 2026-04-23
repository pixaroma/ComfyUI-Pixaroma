import { app } from "/scripts/app.js";
import { BRAND } from "../shared/utils.mjs";

// ---- button / node sizing ----
const BTN_H = 26;
const BTN_GAP = 8;
const BTN_MIN_W = 100;
const BTN_MAX_W = 160;
const STRIP_V_PAD = 6;              // vertical padding inside the button strip
const SIDE_PAD = 8;                 // side margin inside the widget strip

// Minimum node size so the two buttons always fit fully.
const MIN_W = BTN_MIN_W * 2 + BTN_GAP + SIDE_PAD * 2;   // 224
const MIN_H = 260;
const DEFAULT_W = 320;
const DEFAULT_H = 380;

const COLOR_ACTIVE_FILL = BRAND;
const COLOR_ACTIVE_FILL_HOVER = "#ff8a5e";
const COLOR_ACTIVE_STROKE = BRAND;
const COLOR_ACTIVE_TEXT = "#fff";
const COLOR_DISABLED_FILL = "#2a2c2e";
const COLOR_DISABLED_STROKE = "#444";
const COLOR_DISABLED_TEXT = "#999";

const TOAST_MS = 2000;

// ---- geometry (widget-local coords) ----
function computeButtonRects(widgetWidth, stripY) {
  const gap = BTN_GAP;
  const maxTotal = widgetWidth - SIDE_PAD * 2;
  let btnW = Math.floor((maxTotal - gap) / 2);
  btnW = Math.max(BTN_MIN_W, Math.min(BTN_MAX_W, btnW));
  const totalW = btnW * 2 + gap;
  const x0 = Math.max(SIDE_PAD, (widgetWidth - totalW) / 2);
  const y = stripY + STRIP_V_PAD;
  return [
    { id: "disk",   x: x0,              y, w: btnW, h: BTN_H, label: "Save to Disk" },
    { id: "output", x: x0 + btnW + gap, y, w: btnW, h: BTN_H, label: "Save to Output" },
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
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = active ? COLOR_ACTIVE_TEXT : COLOR_DISABLED_TEXT;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function paintToast(ctx, rects, text) {
  const x = rects[0].x;
  const y = rects[0].y;
  const w = rects[1].x + rects[1].w - x;
  const h = rects[0].h;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.86)";
  ctx.strokeStyle = BRAND;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
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

async function saveToDisk(node) {
  if (!node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
  let preparedBlob;
  try {
    const blob = await getPreviewBlob(node);
    if (!blob) throw new Error("no preview blob");
    const dataURL = await blobToDataURL(blob);
    const { workflow, prompt } = await getWorkflowAndPrompt();
    const resp = await fetch("/pixaroma/api/preview/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64: dataURL, workflow, prompt }),
    });
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      showToast(node, `Prepare failed: ${errJson.error || resp.status}`);
      return;
    }
    preparedBlob = await resp.blob();
  } catch (err) {
    showToast(node, `Prepare failed: ${err.message || err}`);
    return;
  }

  const suggestedName = `${readFilenamePrefix(node)}.png`;

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(preparedBlob);
      await writable.close();
      showToast(node, `Saved: ${handle.name}`);
    } catch (err) {
      if (err?.name === "AbortError") return; // user cancelled, silent
      showToast(node, `Save failed: ${err.message || err}`);
    }
    return;
  }

  // Fallback: <a download> → Downloads folder
  const url = URL.createObjectURL(preparedBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast(node, "Saved to Downloads (browser has no folder picker)");
}

// ---- custom widget (buttons sit above the preview image) ----
// Using addCustomWidget rather than onDrawForeground so:
//  (a) buttons redraw with every widget-area repaint — visible immediately on
//      node add, no polling or setDirtyCanvas hack needed
//  (b) LiteGraph reserves vertical space — preview image renders below, never
//      overlaps the buttons or ComfyUI's dimension label
//  (c) identical behavior on legacy and Vue frontends (CLAUDE.md Vue Compat #1)
function createButtonsWidget() {
  return {
    name: "pixaroma_buttons",
    type: "custom",
    value: null,
    serialize: false,
    computeSize(width) {
      return [width, BTN_H + STRIP_V_PAD * 2];
    },
    draw(ctx, node, widget_width, y) {
      const active = !!(node.imgs && node.imgs.length > 0);
      const rects = computeButtonRects(widget_width, y);
      node._pixaromaButtonRects = rects;
      const hoverId = node._pixaromaHoverId || null;
      for (const r of rects) paintBtn(ctx, r, active, hoverId === r.id);

      const toast = node._pixaromaToast;
      if (toast && toast.until > Date.now()) {
        paintToast(ctx, rects, toast.text);
      }
    },
    mouse(event, pos, node) {
      const type = event?.type;
      const rects = node._pixaromaButtonRects || [];

      // Hover tracking — update which button the pointer is over and redraw
      // when that changes. Only triggers a redraw on state transitions to
      // avoid thrashing the canvas on every pointermove pixel.
      if (type === "pointermove" || type === "mousemove") {
        let newHover = null;
        for (const r of rects) {
          if (hitTest(r, pos[0], pos[1])) { newHover = r.id; break; }
        }
        if (newHover !== node._pixaromaHoverId) {
          node._pixaromaHoverId = newHover;
          node.setDirtyCanvas(true, true);
        }
        return false;
      }

      if (type !== "pointerdown" && type !== "mousedown") return false;
      for (const r of rects) {
        if (hitTest(r, pos[0], pos[1])) {
          if (r.id === "output") saveToOutput(node);
          else if (r.id === "disk") saveToDisk(node);
          return true;
        }
      }
      return false;
    },
  };
}

// ---- extension ----
app.registerExtension({
  name: "Pixaroma.Preview",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPreview") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      this.addCustomWidget(createButtonsWidget());
      // Sensible default + minimum size
      if (!this.size || this.size[0] < DEFAULT_W) this.size[0] = DEFAULT_W;
      if (!this.size[1] || this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;
      this.setDirtyCanvas(true, true);
    };

    // Clamp minimum size on manual resize (Compare pattern).
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (origResize) origResize.apply(this, arguments);
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };
  },
});
