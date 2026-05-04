import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
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

// ---- frame-loading helpers ----
function buildViewUrl(entry) {
  const params = new URLSearchParams({
    filename: entry.filename,
    subfolder: entry.subfolder || "",
    type: entry.type || "temp",
    t: String(Date.now()),  // cache-bust same-name files
  });
  return `/view?${params.toString()}`;
}

function loadFrameImage(url, onLoad) {
  const img = new Image();
  img.onload = () => { if (onLoad) onLoad(img); };
  img.src = url;
  return img;
}

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
  const idx = node._pixaromaSelectedFrame ?? 0;
  const frame = node._pixaromaFrames?.[idx];
  if (frame?.url) {
    const resp = await fetch(frame.url);
    if (!resp.ok) throw new Error(`preview fetch failed: ${resp.status}`);
    return await resp.blob();
  }
  // Fallback (legacy state where _pixaromaFrames hasn't populated yet)
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

async function dataURLToBlob(dataURL) {
  const resp = await fetch(dataURL);
  return await resp.blob();
}

async function getWorkflowAndPrompt() {
  // app.graphToPrompt() returns { workflow, output }; "output" is the prompt.
  const { workflow, output } = await app.graphToPrompt();
  return { workflow, prompt: output };
}

function readFilenamePrefix(node) {
  const w = node.widgets?.find((x) => x.name === "filename_prefix");
  const v = (w?.value ?? "img").toString().trim();
  return v || "img";
}

// ---- save handlers ----
async function saveToOutput(node) {
  if (!node._pixaromaFrames?.length && !node.imgs?.length) {
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
  if (!node._pixaromaFrames?.length && !node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
  let preparedBlob;
  let suggestedName = `${readFilenamePrefix(node)}.png`;
  try {
    const blob = await getPreviewBlob(node);
    if (!blob) throw new Error("no preview blob");
    const dataURL = await blobToDataURL(blob);
    const { workflow, prompt } = await getWorkflowAndPrompt();
    const resp = await fetch("/pixaroma/api/preview/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: dataURL,
        filename_prefix: readFilenamePrefix(node),
        workflow,
        prompt,
      }),
    });
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      showToast(node, `Prepare failed: ${errJson.error || resp.status}`);
      return;
    }
    const { image_b64, suggested_filename } = await resp.json();
    if (suggested_filename) suggestedName = suggested_filename;
    preparedBlob = await dataURLToBlob(image_b64);
  } catch (err) {
    showToast(node, `Prepare failed: ${err.message || err}`);
    return;
  }

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
      const active = !!(node._pixaromaFrames?.length || node.imgs?.length);
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

// ---- image strip widget ----
// Renders all batch frames (or one) below the buttons. Selection UI added
// in Task 6 (click → orange BRAND border + "i / N" badge). Returning a
// custom UI key (`pixaroma_preview_frames`) instead of `ui.images` from
// the Python node prevents LiteGraph from drawing its native strip
// underneath this one (Save Mp4 pattern).
const IMG_STRIP_MIN_H = 180;
const IMG_STRIP_GAP = 4;
const IMG_STRIP_V_PAD = 4;
const IMG_STRIP_BORDER_W = 2;       // selection border thickness
const IMG_CELL_MAX_H = 360;          // cap cell height so strip doesn't blow up on wide resizes
const BADGE_PAD = 4;                 // px inside the counter badge
const BADGE_H = 16;                  // px tall badge
const BADGE_FONT = "11px sans-serif";

// `widgetY` is the widget's y-position within the node (passed into draw).
// Returned rects use NODE-local coordinates (absolute), so they can be
// hit-tested directly against the node-local `pos` LiteGraph passes to
// the widget's `mouse(event, pos, node)` callback. This mirrors the
// buttons widget's `computeButtonRects(width, y)` convention in this file.
function layoutImgStrip(widgetWidth, widgetY, frames) {
  const n = frames.length;
  if (!n) return { rects: [], totalH: IMG_STRIP_MIN_H };
  const innerW = Math.max(40, widgetWidth - 2 * SIDE_PAD);
  const cellGap = IMG_STRIP_GAP;
  const fitW = Math.max(40, Math.floor((innerW - cellGap * (n - 1)) / n));
  // Cell aspect: use first loaded frame's natural aspect if available
  const first = frames[0]?.img;
  let aspect = 1;
  if (first?.complete && first.naturalWidth > 0) {
    aspect = first.naturalWidth / first.naturalHeight;
  }
  // Cap cellH at IMG_CELL_MAX_H. If aspect-driven height would exceed it,
  // scale cellW DOWN to preserve aspect ratio (so the image isn't distorted
  // and the strip doesn't grow taller than the cap on wide resizes).
  let cellW = fitW;
  let cellH = Math.max(40, Math.round(cellW / aspect));
  if (cellH > IMG_CELL_MAX_H) {
    cellH = IMG_CELL_MAX_H;
    cellW = Math.max(40, Math.round(cellH * aspect));
  }
  const totalH = cellH + 2 * IMG_STRIP_V_PAD;
  // Centre the row of cells within innerW (left padding may exceed SIDE_PAD
  // when cells were scaled down to fit IMG_CELL_MAX_H).
  const totalCellsW = cellW * n + cellGap * (n - 1);
  const xStart = SIDE_PAD + Math.max(0, Math.floor((innerW - totalCellsW) / 2));
  const rects = [];
  for (let i = 0; i < n; i++) {
    rects.push({
      x: xStart + i * (cellW + cellGap),
      y: widgetY + IMG_STRIP_V_PAD,
      w: cellW,
      h: cellH,
      idx: i,
    });
  }
  return { rects, totalH };
}

function createStripWidget() {
  return {
    name: "pixaroma_strip",
    type: "custom",
    value: null,
    serialize: false,
    computeSize(width) {
      const node = this._node;
      const frames = node?._pixaromaFrames || [];
      // totalH doesn't depend on the widget's y-position, pass 0
      const layout = layoutImgStrip(width, 0, frames);
      return [width, layout.totalH];
    },
    draw(ctx, node, widget_width, y) {
      this._node = node;
      const frames = node._pixaromaFrames || [];
      if (!frames.length) return;
      const layout = layoutImgStrip(widget_width, y, frames);
      node._pixaromaCells = layout;
      const sel = node._pixaromaSelectedFrame ?? 0;
      const total = frames.length;
      for (const r of layout.rects) {
        const f = frames[r.idx];
        if (f?.img?.complete && f.img.naturalWidth > 0) {
          ctx.drawImage(f.img, r.x, r.y, r.w, r.h);
        } else {
          ctx.save();
          ctx.fillStyle = "#222";
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.restore();
        }
        if (total > 1) {
          // Counter badge in bottom-right; BRAND fill if selected, dark otherwise
          const isSel = r.idx === sel;
          const badgeText = `${r.idx + 1} / ${total}`;
          ctx.save();
          ctx.font = BADGE_FONT;
          const textW = ctx.measureText(badgeText).width;
          const badgeW = textW + BADGE_PAD * 2;
          const bx = r.x + r.w - badgeW - 4;
          const by = r.y + r.h - BADGE_H - 4;
          ctx.fillStyle = isSel ? BRAND : "rgba(0,0,0,0.72)";
          ctx.beginPath();
          ctx.roundRect(bx, by, badgeW, BADGE_H, 3);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.fillText(badgeText, bx + BADGE_PAD, by + BADGE_H / 2 + 1);
          ctx.restore();
          if (isSel) {
            // Orange selection border drawn inside the cell (avoids clipping)
            ctx.save();
            ctx.strokeStyle = BRAND;
            ctx.lineWidth = IMG_STRIP_BORDER_W;
            ctx.strokeRect(
              r.x + IMG_STRIP_BORDER_W / 2,
              r.y + IMG_STRIP_BORDER_W / 2,
              r.w - IMG_STRIP_BORDER_W,
              r.h - IMG_STRIP_BORDER_W,
            );
            ctx.restore();
          }
        }
      }
    },
    // Click handling lives in the node-level onMouseDown override below
    // (Vue Compat: widget.mouse() doesn't reliably fire for non-first
    // custom widgets — buttons widget works because it's first; strip
    // widget needs node-level routing).
    mouse() { return false; },
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
      this.addCustomWidget(createStripWidget());
      // Sensible default + minimum size
      if (!this.size || this.size[0] < DEFAULT_W) this.size[0] = DEFAULT_W;
      if (!this.size[1] || this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;
      this.setDirtyCanvas(true, true);
    };

    // Clamp minimum size on manual resize (Compare pattern).
    // Re-fit height on WIDTH changes only — when the user makes the node
    // wider, the strip's cell width grows (and its aspect-driven cell
    // height grows with it), so the strip needs more vertical room.
    // Don't refit on height-only drags so the user can manually adjust
    // height (e.g. to leave more room) without it snapping back.
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (origResize) origResize.apply(this, arguments);
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      const prevW = this._pixaromaPrevWidth ?? this.size[0];
      this._pixaromaPrevWidth = this.size[0];
      if (this._pixaromaFrames?.length && prevW !== this.size[0]) {
        // Defer to next frame so the drag commits first.
        requestAnimationFrame(() => fitNodeToWidgets(this));
      }
    };

    // Node-level click handler for the image strip. The widget's own
    // mouse() callback does not reliably fire on the Vue frontend for
    // non-first custom widgets, so we route strip clicks here. Buttons
    // are still handled by the buttons widget's mouse() (it's the first
    // custom widget — Vue routes clicks to it correctly).
    const origMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, localPos, graphCanvas) {
      const cells = this._pixaromaCells;
      if (cells?.rects?.length) {
        const lx = localPos[0];
        const ly = localPos[1];
        for (const r of cells.rects) {
          if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) {
            if ((this._pixaromaSelectedFrame ?? 0) !== r.idx) {
              this._pixaromaSelectedFrame = r.idx;
              this.setDirtyCanvas(true, true);
            }
            return true; // consume the click so it doesn't bubble
          }
        }
      }
      return origMouseDown ? origMouseDown.apply(this, arguments) : false;
    };

    // Node-level hover tracking. The widget's own `mouse` callback does not
    // receive pointermove events on the Vue frontend, so we track hover at
    // the node level and hit-test against the last-drawn button rects
    // (which the widget stores on node._pixaromaButtonRects each draw).
    const origMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (e, localPos) {
      const rects = this._pixaromaButtonRects || [];
      let newHover = null;
      for (const r of rects) {
        if (hitTest(r, localPos[0], localPos[1])) { newHover = r.id; break; }
      }
      if (newHover !== this._pixaromaHoverId) {
        this._pixaromaHoverId = newHover;
        this.setDirtyCanvas(true, true);
      }
      return origMouseMove ? origMouseMove.apply(this, arguments) : false;
    };

    const origMouseLeave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function () {
      if (this._pixaromaHoverId) {
        this._pixaromaHoverId = null;
        this.setDirtyCanvas(true, true);
      }
      return origMouseLeave ? origMouseLeave.apply(this, arguments) : false;
    };
  },
});

// Listen for ComfyUI's executed event and pull our custom UI key
// (pixaroma_preview_frames) onto the node. We use a custom key (not
// `images`) so LiteGraph doesn't auto-render its native image strip
// underneath our custom widget (Save Mp4 pattern, CLAUDE.md).
api.addEventListener("executed", ({ detail }) => {
  const frames = detail?.output?.pixaroma_preview_frames;
  if (!frames || !frames.length) return;
  // Cross-version node-id resolution: Vue may pass detail.node as a
  // string, legacy as a number — try both.
  let node = app.graph.getNodeById(detail.node);
  if (!node && typeof detail.node === "string") {
    node = app.graph.getNodeById(parseInt(detail.node, 10));
  }
  if (!node || node.type !== "PixaromaPreview") return;

  node._pixaromaFrames = frames.map((f) => {
    const url = buildViewUrl(f);
    return {
      ...f,
      url,
      img: loadFrameImage(url, () => {
        // After image loads, the strip widget's computeSize result changes
        // (height now depends on actual aspect ratio). Force a layout
        // refresh — Vue caches widget bounds from computeSize and won't
        // re-call it on its own, which means clicks below the cached
        // bound never route to the widget. Save Mp4 pattern.
        fitNodeToWidgets(node);
      }),
    };
  });
  // Reset selection if the new batch is smaller than the old one
  if ((node._pixaromaSelectedFrame ?? 0) >= frames.length) {
    node._pixaromaSelectedFrame = 0;
  }
  fitNodeToWidgets(node);
});

// Force LiteGraph + Vue to recompute widget bounds from computeSize, and
// snap the node height to exactly fit the current strip layout.
// Without this, the strip widget's clickable area stays at its initial
// 180px even after frames load — and Vue routes clicks below that to
// nothing. We snap (not just grow) so the node also SHRINKS when the
// user runs a landscape batch after a portrait batch — otherwise the
// node would keep the tall portrait height with empty grey below the
// new shorter image.
function fitNodeToWidgets(node) {
  if (!node || typeof node.computeSize !== "function") return;
  const desired = node.computeSize([node.size[0], node.size[1]]);
  if (node.size[1] !== desired[1]) {
    node.setSize([node.size[0], desired[1]]);
  }
  node.graph?.setDirtyCanvas(true, true);
}
