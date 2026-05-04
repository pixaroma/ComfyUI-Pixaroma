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

// ---- expanded-mode constants (single-frame view INSIDE the node) ----
const EXPAND_CLOSE_SIZE = 26;      // x button square size (clickable area)
const EXPAND_CLOSE_VISUAL = 22;    // visible x button size (drawn smaller for cleaner look)
const EXPAND_CLOSE_PAD = 6;        // padding from image corner
const EXPAND_FOOTER_H = 18;        // strip bottom area reserved for "WxH" text
const EXPAND_DIM_FONT = "11px sans-serif";
const EXPAND_DIM_COLOR = "#888";

// Tracks which preview node is currently in expanded mode, so the global
// keydown listener can route arrow-key navigation to the right node.
let _activePreviewNode = null;

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

// Add `offset` to the numeric counter part of an "img_00002_.png"-style
// name. Preserves zero-padding width. If the pattern doesn't match,
// returns the input unchanged.
function bumpFilenameCounter(name, offset) {
  const m = name.match(/^(.+?_)(\d+)(_\.[^.]+)$/);
  if (!m) return name;
  const newN = String(parseInt(m[2], 10) + offset).padStart(m[2].length, "0");
  return `${m[1]}${newN}${m[3]}`;
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
    if (suggested_filename) {
      // Save-to-Disk writes to the user's chosen folder (not ComfyUI's
      // output/), so folder_paths.get_save_image_path can't observe those
      // files and always returns the same counter — every click would
      // suggest the same name. Track a per-node click offset and bump
      // the counter portion of the suggestion locally.
      const offset = node._pixaromaDiskOffset ?? 0;
      suggestedName = offset > 0
        ? bumpFilenameCounter(suggested_filename, offset)
        : suggested_filename;
    }
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
      node._pixaromaDiskOffset = (node._pixaromaDiskOffset ?? 0) + 1;
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
  node._pixaromaDiskOffset = (node._pixaromaDiskOffset ?? 0) + 1;
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
// Native PreviewImage pattern: minHeight constant, image is fitted inside
// whatever rect the user-resized node gives the widget. No node.setSize
// calls — that's what caused resize flicker.
const IMG_STRIP_MIN_H = 220;
const IMG_STRIP_GAP = 4;
const IMG_STRIP_V_PAD = 4;
const IMG_STRIP_BORDER_W = 2;       // selection border thickness
const BADGE_PAD = 4;                 // px inside the counter badge
const BADGE_H = 16;                  // px tall badge
const BADGE_FONT = "11px sans-serif";

// `widgetY` is the widget's y-position within the node (passed into draw).
// Returned rects use NODE-local coordinates (absolute), so they can be
// hit-tested directly against the node-local `pos` LiteGraph passes to
// the widget's `mouse(event, pos, node)` callback. This mirrors the
// buttons widget's `computeButtonRects(width, y)` convention in this file.
// Layout frames into evenly-divided "slots" across the widget rect, and
// for each slot compute the FITTED image rect (centered, aspect-preserved,
// never upscaled). Click hit-rects are the slot bounds (so users can click
// anywhere in a slot, including letterbox area, to select). The image is
// drawn at the inner fitted rect.
function layoutImgStrip(widgetWidth, widgetY, widgetHeight, frames) {
  const n = frames.length;
  if (!n) return { slots: [], imgs: [] };
  const innerW = Math.max(40, widgetWidth - 2 * SIDE_PAD);
  const innerH = Math.max(40, widgetHeight - 2 * IMG_STRIP_V_PAD);
  const cellGap = IMG_STRIP_GAP;
  // Minimum 16 instead of 40 — at min slots become tiny but still hittable.
  // Forcing 40 used to push the rightmost slots past the node's visible
  // width when the user shrank the node + had many frames, so clicks on
  // those slots fell outside the node's hit area.
  const slotW = Math.max(16, Math.floor((innerW - cellGap * (n - 1)) / n));
  const slots = [];
  const imgs = [];
  for (let i = 0; i < n; i++) {
    const slotX = SIDE_PAD + i * (slotW + cellGap);
    const slotY = widgetY + IMG_STRIP_V_PAD;
    slots.push({ x: slotX, y: slotY, w: slotW, h: innerH, idx: i });

    // Fit image inside slot, preserving aspect, never upscale (native pattern)
    const im = frames[i]?.img;
    let imgRect = { x: slotX, y: slotY, w: slotW, h: innerH };
    if (im?.complete && im.naturalWidth > 0 && im.naturalHeight > 0) {
      const scale = Math.min(slotW / im.naturalWidth, innerH / im.naturalHeight, 1);
      const w = Math.round(im.naturalWidth * scale);
      const h = Math.round(im.naturalHeight * scale);
      imgRect = {
        x: slotX + Math.floor((slotW - w) / 2),
        y: slotY + Math.floor((innerH - h) / 2),
        w,
        h,
      };
    }
    imgs.push(imgRect);
  }
  return { slots, imgs };
}

function createStripWidget() {
  return {
    name: "pixaroma_strip",
    type: "custom",
    value: null,
    serialize: false,
    computeSize(width) {
      // Constant minimum height (native PreviewImage pattern). The actual
      // rendered height is whatever the user-resized node grants — see draw().
      return [width, IMG_STRIP_MIN_H];
    },
    draw(ctx, node, widget_width, y) {
      this._node = node;
      const frames = node._pixaromaFrames || [];
      if (!frames.length) return;
      // Strip is the LAST widget, so it owns whatever vertical space remains
      // between its y and the node's bottom. This is what lets the user
      // freely resize the node taller/shorter without flicker.
      const widgetH = Math.max(IMG_STRIP_MIN_H, node.size[1] - y);
      const sel = node._pixaromaSelectedFrame ?? 0;
      const total = frames.length;

      // ---- Expanded mode: single-frame view inside the node ----
      if (node._pixaromaExpanded) {
        const f = frames[sel];
        const innerW = Math.max(40, widget_width - 2 * SIDE_PAD);
        const innerH = Math.max(40, widgetH - 2 * IMG_STRIP_V_PAD - EXPAND_FOOTER_H);
        // Fit image inside the available rect, centered, never upscale
        let imgRect = { x: SIDE_PAD, y: y + IMG_STRIP_V_PAD, w: innerW, h: innerH };
        if (f?.img?.complete && f.img.naturalWidth > 0) {
          const scale = Math.min(innerW / f.img.naturalWidth, innerH / f.img.naturalHeight, 1);
          const w = Math.round(f.img.naturalWidth * scale);
          const h = Math.round(f.img.naturalHeight * scale);
          imgRect = {
            x: SIDE_PAD + Math.floor((innerW - w) / 2),
            y: y + IMG_STRIP_V_PAD + Math.floor((innerH - h) / 2),
            w, h,
          };
          ctx.drawImage(f.img, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
        } else {
          ctx.save();
          ctx.fillStyle = "#222";
          ctx.fillRect(imgRect.x, imgRect.y, imgRect.w, imgRect.h);
          ctx.restore();
        }

        // Close X button — top-right of the image. Clickable area is
        // larger (EXPAND_CLOSE_SIZE) than visible button (EXPAND_CLOSE_VISUAL)
        // for easier targeting, especially on small node sizes.
        const visualX = imgRect.x + imgRect.w - EXPAND_CLOSE_VISUAL - EXPAND_CLOSE_PAD;
        const visualY = imgRect.y + EXPAND_CLOSE_PAD;
        const closeRect = {
          x: visualX - (EXPAND_CLOSE_SIZE - EXPAND_CLOSE_VISUAL) / 2,
          y: visualY - (EXPAND_CLOSE_SIZE - EXPAND_CLOSE_VISUAL) / 2,
          w: EXPAND_CLOSE_SIZE,
          h: EXPAND_CLOSE_SIZE,
        };
        // Hover detection — read canvas-global mouse, convert to node-local.
        // LiteGraph redraws on pointermove so this re-evaluates on every move.
        const cm = app.canvas?.graph_mouse;
        const mx = cm ? cm[0] - node.pos[0] : -1;
        const my = cm ? cm[1] - node.pos[1] : -1;
        const hoverClose = mx >= closeRect.x && mx <= closeRect.x + closeRect.w
                        && my >= closeRect.y && my <= closeRect.y + closeRect.h;
        ctx.save();
        ctx.fillStyle = hoverClose ? "rgba(255,103,68,0.95)" : "rgba(0,0,0,0.7)";
        ctx.beginPath();
        ctx.roundRect(visualX, visualY, EXPAND_CLOSE_VISUAL, EXPAND_CLOSE_VISUAL, 3);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("×", visualX + EXPAND_CLOSE_VISUAL / 2, visualY + EXPAND_CLOSE_VISUAL / 2 + 1);
        ctx.restore();

        // Counter badge — bottom-right of the image (only when batch > 1)
        if (total > 1) {
          const badgeText = `${sel + 1} / ${total}`;
          ctx.save();
          ctx.font = BADGE_FONT;
          const textW = ctx.measureText(badgeText).width;
          const badgeW = textW + BADGE_PAD * 2;
          const bx = imgRect.x + imgRect.w - badgeW - 4;
          const by = imgRect.y + imgRect.h - BADGE_H - 4;
          ctx.fillStyle = "rgba(0,0,0,0.72)";
          ctx.beginPath();
          ctx.roundRect(bx, by, badgeW, BADGE_H, 3);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.fillText(badgeText, bx + BADGE_PAD, by + BADGE_H / 2 + 1);
          ctx.restore();
        }

        // Dimensions text in the footer below the image
        if (f?.img?.complete && f.img.naturalWidth > 0) {
          const dimText = `${f.img.naturalWidth} × ${f.img.naturalHeight}`;
          ctx.save();
          ctx.fillStyle = EXPAND_DIM_COLOR;
          ctx.font = EXPAND_DIM_FONT;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(dimText, widget_width / 2, y + widgetH - EXPAND_FOOTER_H / 2);
          ctx.restore();
        }

        // Stash hit-test rects: close button + image area (click image
        // to advance to next frame). No `slots` so click handler knows
        // we're in expanded mode.
        node._pixaromaCells = { expanded: true, closeRect, imgRect };
        return;
      }

      // ---- Strip mode (default): row of thumbnails with click-to-expand ----
      const layout = layoutImgStrip(widget_width, y, widgetH, frames);
      node._pixaromaCells = layout;
      for (let i = 0; i < layout.slots.length; i++) {
        const slot = layout.slots[i];
        const imgRect = layout.imgs[i];
        const f = frames[i];
        if (f?.img?.complete && f.img.naturalWidth > 0) {
          ctx.drawImage(f.img, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
        } else {
          ctx.save();
          ctx.fillStyle = "#222";
          ctx.fillRect(imgRect.x, imgRect.y, imgRect.w, imgRect.h);
          ctx.restore();
        }
        if (total > 1) {
          const isSel = i === sel;
          const badgeText = `${i + 1} / ${total}`;
          // Badge in slot's bottom-right (always at slot edge, regardless
          // of where the letterboxed image lands)
          ctx.save();
          ctx.font = BADGE_FONT;
          const textW = ctx.measureText(badgeText).width;
          const badgeW = textW + BADGE_PAD * 2;
          const bx = slot.x + slot.w - badgeW - 4;
          const by = slot.y + slot.h - BADGE_H - 4;
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
            // Orange selection border around the FITTED image (not the slot),
            // so the highlight wraps the visible content
            ctx.save();
            ctx.strokeStyle = BRAND;
            ctx.lineWidth = IMG_STRIP_BORDER_W;
            ctx.strokeRect(
              imgRect.x + IMG_STRIP_BORDER_W / 2,
              imgRect.y + IMG_STRIP_BORDER_W / 2,
              imgRect.w - IMG_STRIP_BORDER_W,
              imgRect.h - IMG_STRIP_BORDER_W,
            );
            ctx.restore();
          }
        }
      }
    },
    // Click handling — LiteGraph routes clicks to widget.mouse() based on
    // widget bounds (computed from `last_y` + `computedHeight`), and STOPS
    // there. Returning false from a widget hit doesn't fall through to
    // node.onMouseDown — so all click logic must live here.
    mouse(event, pos, node) {
      if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
      const cells = node._pixaromaCells;
      if (!cells) return false;
      const lx = pos[0];
      const ly = pos[1];

      // Expanded mode: X closes; click on image advances to next frame.
      if (cells.expanded) {
        const cr = cells.closeRect;
        const ir = cells.imgRect;
        if (cr && lx >= cr.x && lx <= cr.x + cr.w && ly >= cr.y && ly <= cr.y + cr.h) {
          node._pixaromaExpanded = false;
          node.properties = node.properties || {};
          node.properties.pixaromaExpanded = false;
          if (_activePreviewNode === node) _activePreviewNode = null;
          node.setDirtyCanvas(true, true);
          return true;
        }
        if (ir && lx >= ir.x && lx <= ir.x + ir.w && ly >= ir.y && ly <= ir.y + ir.h) {
          const frames = node._pixaromaFrames || [];
          if (frames.length > 1) {
            const cur = node._pixaromaSelectedFrame ?? 0;
            const next = (cur + 1) % frames.length;
            node._pixaromaSelectedFrame = next;
            node.properties = node.properties || {};
            node.properties.pixaromaSelected = next;
            _activePreviewNode = node;
            node.setDirtyCanvas(true, true);
          }
          return true;
        }
        return false;
      }

      // Strip mode: click thumbnail to select it AND expand it inline.
      if (cells.slots?.length) {
        for (const s of cells.slots) {
          if (lx >= s.x && lx <= s.x + s.w && ly >= s.y && ly <= s.y + s.h) {
            node._pixaromaSelectedFrame = s.idx;
            node._pixaromaExpanded = true;
            node.properties = node.properties || {};
            node.properties.pixaromaSelected = s.idx;
            node.properties.pixaromaExpanded = true;
            _activePreviewNode = node;
            node.setDirtyCanvas(true, true);
            return true;
          }
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
      this.addCustomWidget(createStripWidget());
      // Sensible default + minimum size
      if (!this.size || this.size[0] < DEFAULT_W) this.size[0] = DEFAULT_W;
      if (!this.size[1] || this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;
      this.setDirtyCanvas(true, true);
      // Restore preview from properties AFTER configure() runs (Vue Compat
      // #8 — nodeCreated fires before configure, so defer via microtask).
      queueMicrotask(() => restoreFromProperties(this));
    };

    // Also restore on explicit configure (workflow JSON load). Belt-and-
    // braces with the queueMicrotask above — covers both fresh-load and
    // any other path that calls configure after node creation.
    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      return r;
    };

    // Clamp minimum size on manual resize (Compare pattern). The strip
    // widget owns whatever vertical space remains and fits its image
    // inside, so we don't need to mutate the node size on resize —
    // the user is in full control of the node dimensions.
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (origResize) origResize.apply(this, arguments);
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
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
// Hydrate node._pixaromaFrames (HTMLImageElements + URLs) from saved metadata
// stored on node.properties. Called after a fresh executed event AND on
// node restore (workflow load / Vue tab switch) so previews survive across
// sessions, mirroring native PreviewImage behavior.
function hydrateFrames(node, framesMeta) {
  node._pixaromaFrames = framesMeta.map((f) => {
    const url = buildViewUrl(f);
    return {
      filename: f.filename,
      subfolder: f.subfolder || "",
      type: f.type || "temp",
      url,
      img: loadFrameImage(url, () => node.setDirtyCanvas(true, true)),
    };
  });
  if ((node._pixaromaSelectedFrame ?? 0) >= framesMeta.length) {
    node._pixaromaSelectedFrame = 0;
  }
  node.setDirtyCanvas(true, true);
}

// Restore preview from node.properties (called on workflow load / Vue tab
// re-mount). Properties survive serialization, so as long as the temp PNG
// files still exist on disk the preview renders just like native.
function restoreFromProperties(node) {
  if (node._pixaromaFrames?.length) return; // already populated
  const saved = node.properties?.pixaromaFrames;
  if (!Array.isArray(saved) || !saved.length) return;
  node._pixaromaSelectedFrame = node.properties?.pixaromaSelected ?? 0;
  node._pixaromaExpanded = !!node.properties?.pixaromaExpanded;
  hydrateFrames(node, saved);
}

// ---- arrow-key navigation in expanded mode ----
// Capture left/right arrows when a preview is expanded, so they navigate
// frames instead of panning the ComfyUI canvas. Only fires when not
// typing in an input field and the active preview is in expanded mode.
window.addEventListener("keydown", (e) => {
  if (!_activePreviewNode) return;
  if (!_activePreviewNode._pixaromaExpanded) {
    _activePreviewNode = null;
    return;
  }
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Escape") return;
  // Don't hijack typing
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;

  const node = _activePreviewNode;
  const frames = node._pixaromaFrames || [];
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    node._pixaromaExpanded = false;
    node.properties = node.properties || {};
    node.properties.pixaromaExpanded = false;
    _activePreviewNode = null;
    node.setDirtyCanvas(true, true);
    return;
  }
  if (frames.length < 2) return;
  e.preventDefault();
  e.stopPropagation();
  const cur = node._pixaromaSelectedFrame ?? 0;
  const next = e.key === "ArrowLeft"
    ? (cur - 1 + frames.length) % frames.length
    : (cur + 1) % frames.length;
  node._pixaromaSelectedFrame = next;
  node.properties = node.properties || {};
  node.properties.pixaromaSelected = next;
  node.setDirtyCanvas(true, true);
}, true);

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

  // Persist meta on node.properties so the preview survives workflow
  // switching / reload — LiteGraph serializes `properties` to JSON.
  node.properties = node.properties || {};
  node.properties.pixaromaFrames = frames.map((f) => ({
    filename: f.filename,
    subfolder: f.subfolder || "",
    type: f.type || "temp",
  }));
  if ((node._pixaromaSelectedFrame ?? 0) >= frames.length) {
    node._pixaromaSelectedFrame = 0;
  }
  node.properties.pixaromaSelected = node._pixaromaSelectedFrame ?? 0;
  // New run = fresh counter base. Output/ counter has advanced (if save_mode
  // was on) so suggested filename will be naturally newer; reset the local
  // offset so we don't double-jump.
  node._pixaromaDiskOffset = 0;
  hydrateFrames(node, node.properties.pixaromaFrames);
});
