import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { BRAND } from "../shared/utils.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";

// ---- Nodes 2.0 helpers ----
// The Vue "WidgetLegacy" bridge repaints a custom widget's canvas only via
// widget.triggerDraw (set by the bridge on mount) - NOT on node.setDirtyCanvas.
// So any async update (image finished loading, toast shown, frame selected)
// must ALSO poke triggerDraw or the canvas stays frozen on its first paint.
// In the legacy renderer triggerDraw is undefined and setDirtyCanvas does the
// repaint, so this is a no-op there.
function repaint(node) {
  if (!node) return;
  node.setDirtyCanvas?.(true, true);
  if (window.LiteGraph?.vueNodesMode) {
    // Both buttons and strip are DOM widgets in Nodes 2.0: refresh the buttons'
    // enabled-state and re-render the strip canvas.
    node._pixUpdateBtns?.();
    node._pixStripRender?.();
  }
}

// In save_mode=save the node emits ui.images so the Media Assets panel
// refreshes (Pattern #14). ComfyUI would then render its OWN native preview
// panel inside the node body, duplicating our custom strip (and in Nodes 2.0
// that native panel is a flex element that compounds the node height on every
// run). ComfyUI exposes node.hideOutputImages as the official suppression flag:
// the Vue node's preview-media computed early-returns when it's truthy
// (verified in GraphView bundle: `if (!images.length || node.hideOutputImages) return`),
// and ui.images still fires for the Assets refresh. Set once in onNodeCreated.
// In the legacy renderer the native strip is gated on node.imgs (locked to []
// elsewhere), so this flag is simply a harmless no-op there.

// ---- button / node sizing ----
const BTN_H = 26;
const BTN_GAP = 6;
const BTN_MIN_W = 70;
const BTN_MAX_W = 160;
const BTN_COUNT = 4;
const STRIP_V_PAD = 6;              // vertical padding inside the button strip
const SIDE_PAD = 8;                 // side margin inside the widget strip

// Minimum node size so all four buttons always fit fully.
const MIN_W = BTN_MIN_W * BTN_COUNT + BTN_GAP * (BTN_COUNT - 1) + SIDE_PAD * 2;
const MIN_H = 260;
const DEFAULT_W = 360;
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
  // Flag a failed load (e.g. the temp/ PNG was cleared on a ComfyUI restart)
  // so draw() can show "re-run" instead of a silent gray box, and trigger a
  // repaint so that message appears immediately.
  img.onerror = () => { img._pixFailed = true; if (onLoad) onLoad(img); };
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

// ---- layout toggle (top-right icon) ----
const LAYOUT_TOGGLE_SIZE = 22;     // visible square
const LAYOUT_TOGGLE_HIT = 26;      // larger clickable rect for forgiveness
const LAYOUT_TOGGLE_PAD = 6;       // padding from widget corner

// Tracks which preview node is currently in expanded mode, so the global
// keydown listener can route arrow-key navigation to the right node.
let _activePreviewNode = null;

// Make `node` the active (keyboard-driven) preview. If a DIFFERENT node was
// previously expanded, collapse it first - otherwise it would stay visually
// expanded but unreachable by keyboard (arrows/Esc now drive the new node),
// stranding the old one (only its X button could close it).
function setActivePreview(node) {
  const prev = _activePreviewNode;
  if (prev && prev !== node && prev._pixaromaExpanded) {
    prev._pixaromaExpanded = false;
    if (prev.properties) prev.properties.pixaromaExpanded = false;
    repaint(prev);
  }
  _activePreviewNode = node;
}

// Layout mode helpers. The default for new nodes comes from the
// Pixaroma.Preview.DefaultLayout setting (registered below); per-node
// overrides live on node.properties.pixaromaLayout so they persist
// across workflow saves and Vue tab switches.
function getDefaultLayout() {
  try {
    const v = app.ui?.settings?.getSettingValue("Pixaroma.Preview.DefaultLayout");
    return v === "Strip" ? "strip" : "grid";
  } catch {
    return "grid";
  }
}
function getLayoutMode(node) {
  const m = node.properties?.pixaromaLayout;
  return (m === "strip" || m === "grid") ? m : getDefaultLayout();
}
function setLayoutMode(node, mode) {
  node.properties = node.properties || {};
  node.properties.pixaromaLayout = mode;
  repaint(node);
}

// Shared click handler — called from both the strip widget's mouse()
// callback (for clicks inside computeSize bounds) AND nodeType.onMouseDown
// (for clicks in the extended-draw area beyond computeSize). Returns true
// if the click was consumed, false otherwise.
function handleStripClick(node, lx, ly) {
  const cells = node._pixaromaCells;
  if (!cells) return false;

  // Layout toggle (top-right icon) — only present in non-expanded multi-frame
  // mode. Flips Grid <-> Strip for this node.
  const tr = cells.toggleRect;
  if (tr && lx >= tr.x && lx <= tr.x + tr.w && ly >= tr.y && ly <= tr.y + tr.h) {
    setLayoutMode(node, getLayoutMode(node) === "grid" ? "strip" : "grid");
    return true;
  }

  // Expanded mode: X closes; click on image advances to next frame.
  if (cells.expanded) {
    const cr = cells.closeRect;
    const ir = cells.imgRect;
    if (cr && lx >= cr.x && lx <= cr.x + cr.w && ly >= cr.y && ly <= cr.y + cr.h) {
      node._pixaromaExpanded = false;
      node.properties = node.properties || {};
      node.properties.pixaromaExpanded = false;
      if (_activePreviewNode === node) _activePreviewNode = null;
      repaint(node);
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
        setActivePreview(node);
        repaint(node);
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
        setActivePreview(node);
        repaint(node);
        return true;
      }
    }
  }
  return false;
}

// ---- geometry (widget-local coords) ----
function computeButtonRects(widgetWidth, stripY) {
  const gap = BTN_GAP;
  const maxTotal = widgetWidth - SIDE_PAD * 2;
  let btnW = Math.floor((maxTotal - gap * (BTN_COUNT - 1)) / BTN_COUNT);
  // Cap the max, but only a SOFT floor (not BTN_MIN_W): if we floored at
  // BTN_MIN_W the row could become wider than the node and the last button
  // would clip past the frame on a narrow node. Letting btnW shrink keeps the
  // whole row inside widgetWidth (the MIN_W self-heal in the buttons widget
  // keeps it readable at >= BTN_MIN_W in normal use).
  btnW = Math.min(BTN_MAX_W, btnW);
  btnW = Math.max(28, btnW);
  const totalW = btnW * BTN_COUNT + gap * (BTN_COUNT - 1);
  const x0 = Math.max(SIDE_PAD, (widgetWidth - totalW) / 2);
  const y = stripY + STRIP_V_PAD;
  const labels = [
    { id: "disk",   label: "Save Disk" },
    { id: "output", label: "Save Output" },
    { id: "copy",   label: "Copy" },
    { id: "open",   label: "Open" },
  ];
  return labels.map((l, i) => ({
    id: l.id,
    label: l.label,
    x: x0 + i * (btnW + gap),
    y,
    w: btnW,
    h: BTN_H,
  }));
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
  if (!rects.length) return;
  const last = rects[rects.length - 1];
  const x = rects[0].x;
  const y = rects[0].y;
  const w = last.x + last.w - x;
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
  // Nodes 2.0: DOM toast element on the buttons widget.
  if (node._pixBtnToastEl) {
    const el = node._pixBtnToastEl;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(node._pixToastTimer);
    node._pixToastTimer = setTimeout(() => el.classList.remove("show"), TOAST_MS);
    return;
  }
  // Legacy: canvas-painted toast over the buttons canvas widget.
  node._pixaromaToast = { text, until: Date.now() + TOAST_MS };
  repaint(node);
  setTimeout(() => {
    const t = node._pixaromaToast;
    if (t && t.until <= Date.now()) {
      node._pixaromaToast = null;
      repaint(node);
    }
  }, TOAST_MS + 100);
}

// ---- blob / data URI helpers ----
async function getPreviewBlob(node) {
  const idx = node._pixaromaSelectedFrame ?? 0;
  const frame = node._pixaromaFrames?.[idx];
  if (frame?.url) {
    const resp = await fetch(frame.url);
    if (!resp.ok) {
      if (resp.status === 404) throw new Error("preview file missing — Run the workflow again");
      throw new Error(`preview fetch failed: ${resp.status}`);
    }
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

// Strip the "_00001_" counter from an "img_00001_.png"-style name, leaving
// "img.png". If the pattern doesn't match, returns the input unchanged.
// Used by Save Disk when the user opts to omit the counter (the OS Save
// dialog handles overwrite confirmation, so the safety net the counter
// provides is unnecessary on that path).
function stripFilenameCounter(name) {
  return name.replace(/^(.+?)_\d+_(\.[^.]+)$/, "$1$2");
}

async function getWorkflowAndPrompt() {
  // app.graphToPrompt() returns { workflow, output }; "output" is the prompt.
  const { workflow, output } = await app.graphToPrompt();
  return { workflow, prompt: output };
}

// Prefer the EXECUTION-time prompt/workflow captured when this node's frames
// arrived (the exact seed that produced the displayed image). Fall back to the
// live graph only if we have no captured metadata (e.g. a preview restored from
// a previous session via node.properties, with no run this session).
async function resolveSaveMeta(node) {
  // Gate on the WORKFLOW specifically - that's the chunk ComfyUI reads to
  // rebuild the graph on drag-back. If we only had the prompt (e.g. an API
  // run with no extra_pnginfo), we'd embed a workflow-less PNG that can't be
  // dragged back, so fall through to the live graph in that case.
  if (node._pixaromaExecWorkflow) {
    return {
      workflow: node._pixaromaExecWorkflow,
      prompt: node._pixaromaExecPrompt,
    };
  }
  return await getWorkflowAndPrompt();
}

// Try to resolve the value of a wired STRING input by walking back along
// the link to the upstream node and reading its widget. Returns null if
// the input is not wired OR we can't read a clean value (in which case
// the caller should fall back to the local widget default).
//
// Bug class this fixes: when the user wires a cable INTO filename_prefix
// (e.g. Load Image Pixaroma's FILENAME output), Comfy's Python receives
// the wired value at run time, but our JS Save buttons were reading the
// widget's stale "img" default and saving as "img_..." instead. Only the
// Python execution path (save_mode=save) saw the real wired value.
function tryResolveWiredString(node, inputName) {
  const inputIdx = node.inputs?.findIndex((inp) => inp.name === inputName);
  if (inputIdx == null || inputIdx < 0) return null;
  const input = node.inputs[inputIdx];
  if (input?.link == null) return null;

  const graph = node.graph;
  if (!graph) return null;
  // graph.links may be a Map in newer ComfyUI (Vue Compat #3) — try both.
  let link = graph.links?.[input.link];
  if (!link && typeof graph.links?.get === "function") {
    link = graph.links.get(input.link);
  }
  if (!link) return null;

  const upstream = graph.getNodeById(link.origin_id);
  if (!upstream) return null;
  const slot = link.origin_slot;
  const output = upstream.outputs?.[slot];
  if (!output) return null;

  // Pixaroma Load Image's FILENAME output: derive from the `image` widget
  // value (the chosen filename), stripping the extension since
  // filename_prefix is a stem.
  if (upstream.comfyClass === "PixaromaLoadImage" && output.name === "FILENAME") {
    const imgW = upstream.widgets?.find((w) => w.name === "image");
    const raw = imgW?.value?.toString();
    if (raw) {
      const stem = raw.replace(/\.[^.]+$/, "").trim();
      if (stem) return stem;
    }
  }

  // Generic fallback: look for a widget on the upstream node whose name
  // matches the wired output. Covers Primitive STRING nodes and any other
  // utility node that mirrors an output to a same-named widget.
  const matchByName = upstream.widgets?.find((x) =>
    x.name === output.name || x.name === "value"
  );
  if (matchByName?.value != null) {
    const v = matchByName.value.toString().trim();
    if (v) return v;
  }

  // Last resort: if the upstream has exactly one widget, use that.
  if (upstream.widgets?.length === 1) {
    const v = upstream.widgets[0]?.value?.toString().trim();
    if (v) return v;
  }

  return null;
}

function readFilenamePrefix(node) {
  const wired = tryResolveWiredString(node, "filename_prefix");
  if (wired) return wired;
  const w = node.widgets?.find((x) => x.name === "filename_prefix");
  const v = (w?.value ?? "img").toString().trim();
  return v || "img";
}

// ---- copy / open handlers ----
async function copyToClipboard(node) {
  if (!node._pixaromaFrames?.length && !node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    showToast(node, "Clipboard not supported in this browser");
    return;
  }
  try {
    const blob = await getPreviewBlob(node);
    if (!blob) throw new Error("no preview blob");
    // Force image/png — some servers return image/x-png and ClipboardItem
    // is strict about the MIME type matching what's actually in the blob.
    const pngBlob = blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    showToast(node, "Copied to clipboard");
  } catch (err) {
    // NotAllowedError is the common one on http://127.0.0.1 when the page
    // isn't focused (e.g. right after clicking a canvas-painted button) -
    // give a clear hint instead of the raw error.
    if (err?.name === "NotAllowedError") {
      showToast(node, "Copy blocked — click the page, then try again");
      return;
    }
    showToast(node, `Copy failed: ${err.message || err}`);
  }
}

function openInNewTab(node) {
  if (!node._pixaromaFrames?.length && !node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
  const idx = node._pixaromaSelectedFrame ?? 0;
  const frame = node._pixaromaFrames?.[idx];
  const url = frame?.url || node.imgs?.[0]?.src;
  if (!url) {
    showToast(node, "No image to open");
    return;
  }
  // noopener: don't leak `window.opener` to the new tab (it would inherit
  // a reference back to the ComfyUI window).
  const win = window.open(url, "_blank", "noopener");
  if (!win) showToast(node, "Popup blocked");
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
    const { workflow, prompt } = await resolveSaveMeta(node);
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
    const { workflow, prompt } = await resolveSaveMeta(node);
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
      let omit = false;
      try {
        omit = !!app.ui?.settings?.getSettingValue?.("Pixaroma.Preview.OmitCounterOnSaveDisk");
      } catch {}
      if (omit) {
        // User asked for clean filenames. OS Save dialog handles the
        // overwrite prompt, so no offset bumping needed.
        suggestedName = stripFilenameCounter(suggested_filename);
      } else {
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
    // canvasOnly = don't render this widget in the right-sidebar Parameters
    // tab. Without this flag, the Vue frontend draws every widget there too,
    // and each draw() call corrupts node._pixaromaCells with stale Parameters-
    // panel coords - causing the node body's layout to break on tab switch.
    // In Nodes 2.0 a static `true` would hide the widget from the node body
    // too, so the flag is made adaptive via applyAdaptiveCanvasOnly() after
    // addCustomWidget (true in legacy, false in Nodes 2.0).
    options: {},
    computeSize(width) {
      return [width, BTN_H + STRIP_V_PAD * 2];
    },
    draw(ctx, node, widget_width, y) {
      // Enforce minimum width at draw time. onResize is unreliable on the Vue
      // frontend (Compat #13) and Align Pixaroma's resize intercept (Align
      // Pattern #6) can bypass it entirely — both can leave the node narrower
      // than MIN_W with the buttons overflowing past the node frame. Draw
      // always runs, so we self-heal here. setDirtyCanvas triggers the next
      // paint at the corrected width. Legacy only: in Nodes 2.0 the node width
      // is CSS-driven (min-w-(--min-node-width)) and mutating node.size fights
      // the Vue layout, so we leave sizing to the renderer there.
      // Width self-heal in BOTH renderers (keeps the 4 buttons readable; the
      // computeButtonRects soft-floor already prevents clipping). Height
      // self-heal is LEGACY-ONLY - in Nodes 2.0 the body height is flex-managed
      // and writing node.size[1] re-introduces the growth loop.
      if (node.size[0] < MIN_W) {
        node.size[0] = MIN_W;
        node.setDirtyCanvas(true, true);
      }
      if (!isVueNodes() && node.size[1] < MIN_H) {
        node.size[1] = MIN_H;
        node.setDirtyCanvas(true, true);
      }
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
          else if (r.id === "copy") copyToClipboard(node);
          else if (r.id === "open") openInNewTab(node);
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

// 2D-wrapped grid layout — native PreviewImage's algorithm exactly.
// Iterate cols from 1..N, pick the count that maximises total image area
// inside the available rect. Cell dimensions are SCALED IMAGE dimensions
// (not innerW/cols x innerH/rows), so cells exactly fit the images with
// NO per-cell letterbox. The grid is then centered inside the widget.
// Result: thumbnails always look as big as native's, cells touch directly,
// any unused space sits at the edges of the grid (not between cells).
function layoutImgGrid(widgetWidth, widgetY, widgetHeight, frames) {
  const n = frames.length;
  if (!n) return { slots: [], imgs: [] };
  const innerW = Math.max(40, widgetWidth - 2 * SIDE_PAD);
  const innerH = Math.max(40, widgetHeight - 2 * IMG_STRIP_V_PAD);

  // Use first frame for the iterate-and-maximise pass (assumes the batch
  // is uniform, which ComfyUI batches always are). Fall back to a 1xN
  // strip if the image hasn't loaded yet — gets replaced on next draw
  // once natural dimensions are known.
  const firstImg = frames[0]?.img;
  const imgW = firstImg?.complete && firstImg.naturalWidth > 0 ? firstImg.naturalWidth : 1;
  const imgH = firstImg?.complete && firstImg.naturalHeight > 0 ? firstImg.naturalHeight : 1;

  let bestCols = 1, bestRows = n, bestCellW = innerW, bestCellH = innerH / n, bestArea = -1;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const slotW = innerW / c;
    const slotH = innerH / r;
    // CONTAIN fit, capped at 1 so smaller images never upscale past native.
    const scale = Math.min(slotW / imgW, slotH / imgH, 1);
    const cellW = imgW * scale;
    const cellH = imgH * scale;
    const area = cellW * cellH * n;
    if (area > bestArea) {
      bestArea = area;
      bestCols = c;
      bestRows = r;
      bestCellW = cellW;
      bestCellH = cellH;
    }
  }
  const cols = bestCols, rows = bestRows;
  const cellW = Math.max(16, Math.floor(bestCellW));
  const cellH = Math.max(16, Math.floor(bestCellH));
  // Center the whole grid in the available rect (matches native's shiftX).
  const gridW = cellW * cols;
  const gridH = cellH * rows;
  const startX = SIDE_PAD + Math.max(0, Math.floor((innerW - gridW) / 2));
  const startY = widgetY + IMG_STRIP_V_PAD + Math.max(0, Math.floor((innerH - gridH) / 2));

  const slots = [];
  const imgs = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = startX + c * cellW;
    const y = startY + r * cellH;
    // Cell == fitted image rect: no per-cell letterbox to center within.
    slots.push({ x, y, w: cellW, h: cellH, idx: i });
    imgs.push({ x, y, w: cellW, h: cellH });
  }
  return { slots, imgs };
}

// Paint the layout-toggle icon (top-right of the widget, multi-frame
// non-expanded only). Icon shows the OPPOSITE of the current mode so the
// glyph signals "click to switch to this". Hover lights up BRAND.
// Returns the hit rect (larger than the visible square for click forgiveness).
function paintLayoutToggle(ctx, node, widget_width, widgetY, currentMode) {
  const visualX = widget_width - LAYOUT_TOGGLE_SIZE - LAYOUT_TOGGLE_PAD;
  const visualY = widgetY + LAYOUT_TOGGLE_PAD;
  const hitRect = {
    x: visualX - (LAYOUT_TOGGLE_HIT - LAYOUT_TOGGLE_SIZE) / 2,
    y: visualY - (LAYOUT_TOGGLE_HIT - LAYOUT_TOGGLE_SIZE) / 2,
    w: LAYOUT_TOGGLE_HIT,
    h: LAYOUT_TOGGLE_HIT,
  };

  const cm = app.canvas?.graph_mouse;
  const mx = cm ? cm[0] - node.pos[0] : -1;
  const my = cm ? cm[1] - node.pos[1] : -1;
  const hover = mx >= hitRect.x && mx <= hitRect.x + hitRect.w
             && my >= hitRect.y && my <= hitRect.y + hitRect.h;

  ctx.save();
  ctx.fillStyle = hover ? "rgba(255,103,68,0.95)" : "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.roundRect(visualX, visualY, LAYOUT_TOGGLE_SIZE, LAYOUT_TOGGLE_SIZE, 3);
  ctx.fill();

  // Glyph shows the OTHER mode (what you'll switch to on click)
  ctx.fillStyle = "#fff";
  const cx = visualX + LAYOUT_TOGGLE_SIZE / 2;
  const cy = visualY + LAYOUT_TOGGLE_SIZE / 2;
  if (currentMode === "grid") {
    // Show "strip" glyph: three short horizontal bars
    const barW = 12, barH = 1.6, gap = 3;
    const totalH = barH * 3 + gap * 2;
    const startY = cy - totalH / 2;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(cx - barW / 2, startY + i * (barH + gap), barW, barH);
    }
  } else {
    // Show "grid" glyph: 2x2 small dots
    const dotSize = 4, dotGap = 2;
    const totalSide = dotSize * 2 + dotGap;
    const sx = cx - totalSide / 2;
    const sy = cy - totalSide / 2;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        ctx.fillRect(sx + c * (dotSize + dotGap), sy + r * (dotSize + dotGap), dotSize, dotSize);
      }
    }
  }
  ctx.restore();
  return hitRect;
}

function createStripWidget() {
  return {
    name: "pixaroma_strip",
    type: "custom",
    value: null,
    serialize: false,
    // canvasOnly: skip this widget in the Parameters tab (Vue Compat #15).
    options: {},
    // This canvas custom widget is used ONLY by the legacy renderer now (Nodes
    // 2.0 uses a DOM-widget strip instead - see createStripDOMWidget). Legacy
    // fills the node via draw()'s `node.size[1] - y`, so computeSize just
    // reserves the minimum height.
    computeSize(width) {
      return [width, IMG_STRIP_MIN_H];
    },
    draw(ctx, node, widget_width, y, h) {
      this._node = node;
      const frames = node._pixaromaFrames || [];
      if (!frames.length) return;
      // Height resolution:
      //  - Nodes 2.0: the bridge passes the real canvas height as `h` (= the
      //    flex-distributed computedHeight). `y` is always 1 there, so the
      //    node.size math is meaningless - use `h` directly.
      //  - Legacy: strip is the LAST widget and owns the leftover node body, so
      //    fill from `y` to the node bottom (lets the user resize freely).
      const widgetH = (window.LiteGraph?.vueNodesMode && typeof h === "number" && h > 0)
        ? h
        : Math.max(IMG_STRIP_MIN_H, node.size[1] - y);
      const sel = node._pixaromaSelectedFrame ?? 0;
      const total = frames.length;

      // ---- Expanded view: single-frame display inside the node ----
      // Triggered manually for batches (click thumbnail) OR automatically
      // for single-frame batches (no need for a strip when there's only
      // one). Single-frame mode skips the close X (nothing to go back to).
      const isSingle = total === 1;
      if (node._pixaromaExpanded || isSingle) {
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
          // Temp PNG gone (e.g. ComfyUI restart) - say so on the big preview
          // (skip tiny thumbnails where the text would overflow).
          if (f?.img?._pixFailed && imgRect.w > 120) {
            ctx.fillStyle = "#888";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              "Preview expired — run again",
              imgRect.x + imgRect.w / 2,
              imgRect.y + imgRect.h / 2,
            );
          }
          ctx.restore();
        }

        // Close X button — only when a batch was expanded by clicking a
        // thumbnail. Single-frame views have nothing to collapse back to.
        let closeRect = null;
        if (!isSingle) {
          const visualX = imgRect.x + imgRect.w - EXPAND_CLOSE_VISUAL - EXPAND_CLOSE_PAD;
          const visualY = imgRect.y + EXPAND_CLOSE_PAD;
          closeRect = {
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
        }

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

      // ---- Multi-frame mode: row (Strip) or 2D wrapped (Grid) ----
      const mode = getLayoutMode(node);
      const layout = mode === "grid"
        ? layoutImgGrid(widget_width, y, widgetH, frames)
        : layoutImgStrip(widget_width, y, widgetH, frames);
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
          // Temp PNG gone (e.g. ComfyUI restart) - say so on the big preview
          // (skip tiny thumbnails where the text would overflow).
          if (f?.img?._pixFailed && imgRect.w > 120) {
            ctx.fillStyle = "#888";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              "Preview expired — run again",
              imgRect.x + imgRect.w / 2,
              imgRect.y + imgRect.h / 2,
            );
          }
          ctx.restore();
        }
        if (total > 1) {
          const isSel = i === sel;
          // Selection border first, badge on top — so the dark badge is
          // never crossed by the orange stroke. Border wraps the fitted
          // image (not the slot) so the highlight follows the visible
          // content, even when the image is letterboxed inside the slot.
          if (isSel) {
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
          // Badge anchored to imgRect bottom-right (always on the actual
          // image, never floating in letterbox padding). Always dark — the
          // orange border already communicates selection, so an orange
          // badge on top of an orange border would merge into one blob.
          const badgeText = `${i + 1} / ${total}`;
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
      }

      // Layout toggle in top-right (multi-frame, non-expanded only).
      // Drawn last so it always sits above the thumbnails.
      if (total > 1) {
        node._pixaromaCells.toggleRect = paintLayoutToggle(ctx, node, widget_width, y, mode);
      }
    },
    // Click handling. LiteGraph routes clicks to widget.mouse() ONLY when
    // the click falls within the widget's computeSize bounds. Our strip
    // widget reports a constant 220 minHeight (matches native), but draws
    // at `node.size[1] - y` (taller when user resizes node bigger) — so
    // clicks in the extended-draw area never reach widget.mouse(). The
    // shared handleStripClick helper is also called from node.onMouseDown
    // below (which fires when no widget claimed the click) so clicks
    // anywhere over visible thumbnails work at any node size.
    mouse(event, pos, node) {
      if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
      return handleStripClick(node, pos[0], pos[1]);
    },
  };
}

// ---- Nodes 2.0 buttons: real DOM <button>s ----
// In Nodes 2.0 the canvas-bridged buttons widget gets less usable width than
// legacy for the same node size, so the 4 buttons overlap (text runs together).
// A DOM flex row fits them to the real node width (shrink + ellipsis, never
// overlap) and restores hover. Legacy keeps the canvas buttons widget.
function injectButtonsCSS() {
  if (document.getElementById("pix-preview-btns-css")) return;
  const s = document.createElement("style");
  s.id = "pix-preview-btns-css";
  s.textContent = `
    .pix-pv-btns { position:relative; width:100%; box-sizing:border-box; padding:0 ${SIDE_PAD}px; }
    .pix-pv-btns-row { display:flex; gap:${BTN_GAP}px; }
    .pix-pv-btn {
      flex:1 1 0; min-width:0; height:${BTN_H}px; line-height:${BTN_H - 2}px;
      border:1px solid ${BRAND}; border-radius:4px; background:${BRAND}; color:#fff;
      font:12px sans-serif; padding:0 6px; box-sizing:border-box; cursor:pointer;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; user-select:none;
    }
    .pix-pv-btn:hover:not(:disabled) { background:${COLOR_ACTIVE_FILL_HOVER}; border-color:${COLOR_ACTIVE_FILL_HOVER}; }
    .pix-pv-btn:disabled { background:${COLOR_DISABLED_FILL}; border-color:${COLOR_DISABLED_STROKE}; color:${COLOR_DISABLED_TEXT}; cursor:default; }
    .pix-pv-toast {
      position:absolute; left:${SIDE_PAD}px; right:${SIDE_PAD}px; top:0; height:${BTN_H}px;
      display:none; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.86); border:1px solid ${BRAND}; border-radius:4px;
      color:#fff; font:11px sans-serif; pointer-events:none;
    }
    .pix-pv-toast.show { display:flex; }
  `;
  document.head.appendChild(s);
}

function createButtonsDOMWidget(node) {
  injectButtonsCSS();
  const root = document.createElement("div");
  root.className = "pix-pv-btns";
  const row = document.createElement("div");
  row.className = "pix-pv-btns-row";
  const defs = [
    ["Save Disk", saveToDisk],
    ["Save Output", saveToOutput],
    ["Copy", copyToClipboard],
    ["Open", openInNewTab],
  ];
  const btnEls = [];
  for (const [label, fn] of defs) {
    const b = document.createElement("button");
    b.className = "pix-pv-btn";
    b.textContent = label;
    b.title = label;
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(node); });
    row.appendChild(b);
    btnEls.push(b);
  }
  root.appendChild(row);
  const toast = document.createElement("div");
  toast.className = "pix-pv-toast";
  root.appendChild(toast);

  const BTN_BAND = BTN_H + STRIP_V_PAD * 2;
  const widget = node.addDOMWidget("pixaroma_buttons", "pixaroma_preview_buttons", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => BTN_BAND,
  });
  applyAdaptiveCanvasOnly(widget);
  // The node body is a CSS grid: a widget WITH a computeLayoutSize method gets a
  // flexible `auto` grid row, while one WITHOUT gets a fixed `min-content` row.
  // addDOMWidget assigns a default computeLayoutSize, which made the buttons row
  // ALSO grab free space (so the grid split the slack between buttons and strip,
  // and the strip never filled). Removing it makes the buttons a fixed
  // (content-height) row, leaving the strip as the ONLY growable row so it
  // absorbs all the node's free vertical space.
  try { delete widget.computeLayoutSize; } catch {}
  widget.computeLayoutSize = undefined;

  node._pixBtnToastEl = toast;
  node._pixUpdateBtns = () => {
    const active = !!(node._pixaromaFrames?.length);
    for (const b of btnEls) b.disabled = !active;
  };
  node._pixUpdateBtns();
  return widget;
}

// ---- Nodes 2.0 strip: a real DOM widget ----
// In Nodes 2.0 a bridged-canvas custom widget CANNOT fill-and-resize: tying its
// height to node.size feeds back (node height is content-derived there) and the
// WidgetLegacy bridge's canvas+2 makes a flex row snowball. ComfyUI's own image
// preview avoids this by being a DOM element that fills via CSS flex. We mirror
// that: a <div> + <canvas> DOM widget with computeLayoutSize (flex), whose inner
// canvas is sized by a ResizeObserver to the element's box (NO +2). It reuses the
// EXACT same draw()/mouse() logic as the legacy canvas widget via a throwaway
// strip-logic object, so the two renderers render identically. The legacy path
// is left untouched on the canvas widget above.
function createStripDOMWidget(node) {
  const logic = createStripWidget(); // reuse draw()/mouse() unchanged

  const root = document.createElement("div");
  root.className = "pix-preview-strip-root";
  // ComfyUI wraps this element in a host <div class="flex flex-col *:flex-1">
  // (a flex column whose direct children get flex:1). To actually FILL the
  // flex-allocated height (computedHeight), the element needs `flex:1 1 0` AND
  // `min-height:0` - a flex item defaults to min-height:auto (= content height),
  // which made it collapse to ~526px instead of the allocated ~887px. The 220px
  // floor is guaranteed by computeLayoutSize.minHeight below, so we must NOT set
  // height:100% / min-height:220 here (they fight the flex fill). Verified
  // against the GraphView/WidgetDOM bundle + native ImagePreview (flex-auto +
  // min-h-0 + absolute object-contain image).
  root.style.cssText =
    "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  root.appendChild(canvas);

  const widget = node.addDOMWidget("pixaroma_strip", "pixaroma_preview_strip", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => IMG_STRIP_MIN_H,
  });
  // Flex/fill in the Vue node-layout (free of the canvas-bridge +2 loop because
  // WidgetDOM sizes the element via CSS, not a backing canvas).
  widget.computeLayoutSize = () => ({ minHeight: IMG_STRIP_MIN_H, minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);

  const render = () => {
    const cssW = root.clientWidth;
    const cssH = root.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    // y=0 origin (the canvas IS the strip area); height = the element's box.
    logic.draw(ctx, node, cssW, 0, cssH);
  };
  node._pixStripRender = render;

  const ro = new ResizeObserver(() => render());
  ro.observe(root);
  node._pixStripRO = ro;

  // Click: container-local coords share the y=0 origin that render() draws with,
  // so they hit-test directly against node._pixaromaCells.
  // Scale-correct for graph zoom: the Vue node is CSS-transform-scaled by the
  // graph zoom, so getBoundingClientRect() returns SCREEN px while render() /
  // draw() work in LAYOUT px (root.clientWidth/Height). Using the raw
  // clientX-left offset makes every hit-test drift as you zoom in (same bug
  // Compare had - the big thumbnails here just masked it). Multiply the offset
  // by clientWidth/rect.width (= 1/zoom) on both axes.
  root.addEventListener("pointerdown", (e) => {
    const r = root.getBoundingClientRect();
    const sx = r.width ? root.clientWidth / r.width : 1;
    const sy = r.height ? root.clientHeight / r.height : 1;
    const lx = (e.clientX - r.left) * sx;
    const ly = (e.clientY - r.top) * sy;
    if (handleStripClick(node, lx, ly)) {
      e.stopPropagation();
    }
  });

  // initial paint once laid out
  requestAnimationFrame(render);
  return widget;
}

// ---- extension ----
app.registerExtension({
  name: "Pixaroma.Preview",

  settings: [
    {
      id: "Pixaroma.Preview.DefaultLayout",
      name: "Default batch layout",
      type: "combo",
      defaultValue: "Grid",
      options: ["Grid", "Strip"],
      tooltip: "How a multi-image batch is laid out in the Preview Image Pixaroma node body. Grid wraps into rows (matches native ComfyUI); Strip is a single horizontal row. Each node also has its own toggle in the top-right of the preview area; this setting only affects the default for newly-created nodes.",
      category: ["👑 Pixaroma", "Preview"],
    },
    {
      // Distinct leaf category required: Vue's settings UI silently
      // drops a row when two settings share the same leaf name
      // (CLAUDE.md Align Pattern #10). DefaultLayout already owns
      // "Preview", so this one uses "Preview (save mode)".
      id: "Pixaroma.Preview.DefaultSaveMode",
      name: "Default save mode",
      type: "combo",
      defaultValue: "Preview",
      options: ["Preview", "Save"],
      tooltip: "Initial value of the save_mode widget on newly-created Preview Image Pixaroma nodes. Preview writes batch frames to ComfyUI's temp/ folder (auto-cleared on restart, no clutter). Save writes them to output/ with embedded workflow metadata, like native SaveImage. Existing nodes keep whatever save_mode they were saved with - this setting only affects fresh nodes you drop on the canvas.",
      category: ["👑 Pixaroma", "Preview (save mode)"],
    },
    {
      // Distinct leaf category — Align Pattern #10. Affects ONLY the
      // Save Disk button; Save Output keeps its counter because it
      // writes silently to ComfyUI's output/ folder with no overwrite
      // prompt (dropping the counter there would clobber prior runs).
      id: "Pixaroma.Preview.OmitCounterOnSaveDisk",
      name: "Save Disk: omit counter from filename",
      type: "boolean",
      defaultValue: false,
      tooltip: "When ON, the Save Disk button suggests filenames without the auto-counter (e.g. 'myimage.png' instead of 'myimage_00001_.png'). The OS Save dialog will warn you before overwriting an existing file. Save Output is unaffected — it always keeps the counter to protect prior runs.",
      category: ["👑 Pixaroma", "Preview (disk save)"],
    },
  ],

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPreview") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      // Suppress ComfyUI's native output-image preview (see the note above the
      // imports). We render our own strip; the native one would duplicate it
      // and, in Nodes 2.0, grow the node on every run.
      this.hideOutputImages = true;
      // applyAdaptiveCanvasOnly: keep these out of the legacy Parameters tab
      // (canvasOnly true) while still rendering them in the Nodes 2.0 Vue body
      // (canvasOnly false). addCustomWidget returns the widget it added.
      // Nodes 2.0 gets DOM widgets (buttons = flex row, strip = flex canvas) so
      // they fit the real node width and don't fight the canvas bridge; legacy
      // keeps the canvas custom widgets (which fill via draw()'s node.size[1]-y).
      // The renderer is fixed per page load, so only one path is active per node.
      if (isVueNodes()) {
        createButtonsDOMWidget(this);
        createStripDOMWidget(this);
      } else {
        applyAdaptiveCanvasOnly(this.addCustomWidget(createButtonsWidget()));
        applyAdaptiveCanvasOnly(this.addCustomWidget(createStripWidget()));
      }

      // Suppress ComfyUI's native canvas-image-preview widget. Since
      // node_preview.py now emits `ui.images` in save_mode=save (so the
      // Media Assets panel refreshes), ComfyUI's frontend would otherwise
      // assign the returned images to `node.imgs` and then auto-add a
      // `$$canvas-image-preview` widget below our custom strip widget,
      // producing a SECOND thumbnail. The gate is just `node.imgs?.length`
      // (verified against dialogService bundle's showCanvasImagePreview),
      // so locking imgs to an empty array prevents the widget from ever
      // being added. Same pattern Prompt Reader Pixaroma uses; see
      // Prompt Reader Pixaroma Pattern #2 in CLAUDE.md.
      const imgsDesc = Object.getOwnPropertyDescriptor(this, "imgs");
      if (imgsDesc && imgsDesc.configurable === false) {
        console.warn("[PixaromaPreview] cannot suppress node.imgs - existing descriptor is non-configurable");
      } else {
        try {
          Object.defineProperty(this, "imgs", {
            configurable: true,
            get() { return []; },
            set(_v) { /* swallow */ },
          });
        } catch (e) {
          console.warn("[PixaromaPreview] node.imgs suppression failed:", e.message);
        }
      }

      // Apply user's preferred default save_mode for fresh nodes.
      // onNodeCreated fires BEFORE configure() (Vue Compat #8), so for a
      // saved-workflow node configure() will overwrite this with the
      // serialised value - exactly what we want. Fresh-on-canvas nodes
      // have no saved value, so this stick.
      try {
        const pref = app.ui?.settings?.getSettingValue?.("Pixaroma.Preview.DefaultSaveMode") || "Preview";
        const target = pref === "Save" ? "save" : "preview";
        const w = this.widgets?.find((x) => x.name === "save_mode");
        if (w && w.value !== target) w.value = target;
      } catch {}

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

    // Node-level click fallback — fires when LiteGraph's widget hit-test
    // didn't match (i.e. click in the extended-draw area below the strip
    // widget's computeSize bound). Re-runs handleStripClick against the
    // same _pixaromaCells.slots that the widget would test.
    const origMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, localPos, graphCanvas) {
      if (handleStripClick(this, localPos[0], localPos[1])) return true;
      return origMouseDown ? origMouseDown.apply(this, arguments) : false;
    };

    // Clear _activePreviewNode if THIS node is being removed, so the
    // keydown listener doesn't hold a dangling reference to a deleted node.
    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (_activePreviewNode === this) _activePreviewNode = null;
      // Release the DOM-widget strip's ResizeObserver (Nodes 2.0 only).
      try { this._pixStripRO?.disconnect(); } catch {}
      this._pixStripRO = null;
      this._pixStripRender = null;
      clearTimeout(this._pixToastTimer);
      return origRemoved ? origRemoved.apply(this, arguments) : undefined;
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
      // repaint (not setDirtyCanvas) so the image actually appears in Nodes 2.0,
      // where the bridged canvas only repaints via widget.triggerDraw.
      img: loadFrameImage(url, () => repaint(node)),
    };
  });
  if ((node._pixaromaSelectedFrame ?? 0) >= framesMeta.length) {
    node._pixaromaSelectedFrame = 0;
  }
  repaint(node);
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
    repaint(node);
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
  repaint(node);
}, true);

api.addEventListener("executed", ({ detail }) => {
  // Cross-version node-id resolution: Vue may pass detail.node as a
  // string, legacy as a number — try both.
  let node = app.graph.getNodeById(detail.node);
  if (!node && typeof detail.node === "string") {
    node = app.graph.getNodeById(parseInt(detail.node, 10));
  }
  if (!node || node.type !== "PixaromaPreview") return;

  // Save mode emits `ui.images` (so the Media Assets panel refreshes);
  // preview mode emits `ui.pixaroma_preview_frames`. Either way it's the
  // SAME shape (`[{filename, subfolder, type, _pixaroma_meta?}]`), so we
  // read whichever key is present. This single-key-per-mode design keeps
  // the Assets stack-count badge at 1 (server counts items across all
  // list-keyed arrays - see node_preview.py comment).
  const frames =
    detail?.output?.pixaroma_preview_frames ||
    detail?.output?.images;
  if (!frames || !frames.length) return;

  // Note: node.imgs is permanently locked to [] via Object.defineProperty
  // in onNodeCreated (so ComfyUI's native canvas-image-preview widget
  // never gets added even though we emit ui.images in save mode).

  // Capture the EXECUTION-time prompt + workflow (the seed that actually
  // made this image) so the Save buttons embed it instead of the live,
  // post-"randomize" graph state. Now embedded as a field on the first
  // frame entry (instead of a separate ui.pixaroma_preview_meta key) so
  // the Assets stack-count stays at 1. Runtime-only (NOT persisted to
  // node.properties - that would recursively bloat the saved workflow).
  const execMeta = frames[0]?._pixaroma_meta;
  if (execMeta) {
    node._pixaromaExecPrompt = execMeta.prompt ?? null;
    node._pixaromaExecWorkflow = execMeta.workflow ?? null;
  }

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
  // Fresh run = reset expanded view state. Without this, going from a
  // batch (in expanded mode) to a single-image run leaves a leftover
  // close X visible until the user clicks it. Single-image renders
  // auto-expanded with no X anyway (see strip widget draw()), so the
  // explicit flag should be off after every run.
  node._pixaromaExpanded = false;
  node.properties.pixaromaExpanded = false;
  if (_activePreviewNode === node) _activePreviewNode = null;
  // New run = fresh counter base. Output/ counter has advanced (if save_mode
  // was on) so suggested filename will be naturally newer; reset the local
  // offset so we don't double-jump.
  node._pixaromaDiskOffset = 0;
  // Belt-and-braces: ensure the native preview stays suppressed even if a
  // restored/older node instance missed the onNodeCreated assignment.
  node.hideOutputImages = true;
  hydrateFrames(node, node.properties.pixaromaFrames);
});
