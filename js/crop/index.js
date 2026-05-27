// ============================================================
// Pixaroma Image Crop Editor — Entry Point
// ============================================================
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { CropEditor } from "./core.mjs";
import "./interaction.mjs"; // mixin: mouse/keyboard events
import "./render.mjs"; // mixin: canvas rendering, ratio, save
import { createCropPanel } from "./panel.mjs";
import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "../shared/index.mjs";

// ─── Upstream-image resolver ──────────────────────────────────────────────
// Walks the graph from this node's "image" input to find a usable preview URL.
// Mirrors the composer/placeholder.mjs::getUpstreamImageUrlForNode helper but
// scoped to a single fixed input. Returns null when nothing is connected or
// the source has no preview yet.
function getUpstreamImageURL(node) {
  // Priority 1: cached source URL emitted by the Python node on its last
  // execute. Works for any upstream type (VAE Decode etc.), not just LoadImage.
  if (node._pixaromaCropSourceURL) return node._pixaromaCropSourceURL;

  const inputs = node.inputs || [];
  const input = inputs.find((inp) => inp.name === "image");
  if (!input || input.link == null) return null;
  const graph = node.graph;
  if (!graph) return null;

  // Vue Compat #3: graph.links can be a Map in newer ComfyUI versions.
  let link = graph.links?.[input.link];
  if (!link && typeof graph.links?.get === "function") link = graph.links.get(input.link);
  if (!link) return null;
  const srcNode = graph.getNodeById(link.origin_id);
  if (!srcNode) return null;

  // LoadImage: read filename from its "image" widget.
  if (srcNode.comfyClass === "LoadImage" || srcNode.type === "LoadImage") {
    const imgWidget = (srcNode.widgets || []).find((w) => w.name === "image");
    if (imgWidget && imgWidget.value) {
      return `/view?filename=${encodeURIComponent(imgWidget.value)}&type=input&t=${Date.now()}`;
    }
  }

  // Any node with cached preview images post-execution.
  if (srcNode.imgs && srcNode.imgs.length > 0) {
    const img = srcNode.imgs[link.origin_slot] || srcNode.imgs[0];
    if (typeof img === "string") return img;
    if (img && img.src) return img.src;
  }

  return null;
}

// ─── Upstream snapshot for change detection ───────────────────────────────
// Same idea as composer's polling — onDrawForeground doesn't fire in Vue,
// so we sample upstream state at intervals to know when to refresh the
// preview. CRITICAL: this must NOT include the Date.now() cache-buster the
// URL helper adds; a timestamp-based snapshot would change every poll and
// trigger a rebuild every 500ms even when the actual upstream is unchanged.
function getUpstreamSnapshot(node) {
  // The cached source URL is part of the identity — when it arrives or
  // changes (new execute), we should rebuild the mini-preview.
  if (node._pixaromaCropSourceURL) return `cropSrc:${node._pixaromaCropSourceURL}`;

  const inputs = node.inputs || [];
  const input = inputs.find((inp) => inp.name === "image");
  if (!input || input.link == null) return "";
  const graph = node.graph;
  if (!graph) return "";
  let link = graph.links?.[input.link];
  if (!link && typeof graph.links?.get === "function") link = graph.links.get(input.link);
  if (!link) return "";
  const srcNode = graph.getNodeById(link.origin_id);
  if (!srcNode) return "";

  // LoadImage: stable identity = the filename widget value.
  if (srcNode.comfyClass === "LoadImage" || srcNode.type === "LoadImage") {
    const w = (srcNode.widgets || []).find((x) => x.name === "image");
    if (w && w.value) return `LoadImage:${w.value}`;
  }
  // Any node with cached preview images post-execution.
  if (srcNode.imgs && srcNode.imgs.length > 0) {
    const img = srcNode.imgs[link.origin_slot] || srcNode.imgs[0];
    const s = typeof img === "string" ? img : img?.src || "";
    if (s) return `imgs:${s}`;
  }
  return `link:${link.origin_id}/${link.origin_slot}`;
}

// Build a /view URL from a {filename, subfolder, type} record. Adds a fresh
// cache-buster timestamp at runtime; persisted records (in node.properties)
// store only the structural parts so workflow JSON stays clean.
function buildSourceURL(part, withCacheBust) {
  if (!part || !part.filename) return null;
  const url = `/view?filename=${encodeURIComponent(part.filename)}` +
              `&subfolder=${encodeURIComponent(part.subfolder || "")}` +
              `&type=${encodeURIComponent(part.type || "temp")}`;
  return withCacheBust ? `${url}&t=${Date.now()}` : url;
}

// ─── Global paste handler (clipboard → selected Crop node) ────────────────
// Mirrors the way native LoadImage accepts a clipboard paste: when the user
// presses Ctrl+V with an image in the clipboard AND a PixaromaCrop node is
// selected AND no upstream wire is connected, the image is uploaded to
// input/pixaroma/ and used as the source. Skipped silently when an upstream
// is wired (the workflow uses that tensor, pasting would be confusing).
let _pasteHandlerInstalled = false;
function installPasteHandler() {
  if (_pasteHandlerInstalled) return;
  _pasteHandlerInstalled = true;
  // Capture phase + stopImmediatePropagation can't fully suppress ComfyUI's
  // own paste handler (it registers earlier in the page lifecycle). So we
  // also snapshot graph node ids before, then remove any LoadImage with a
  // "pasted/" filename that ComfyUI auto-created from the same paste event.
  window.addEventListener("paste", async (e) => {
    // Don't steal paste from form fields (panel inputs, editor inputs, etc.)
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    const node = findActiveCropNode();
    if (!node) return;

    const items = e.clipboardData?.items || [];
    const imageItem = Array.from(items).find((it) => it.type?.startsWith("image/"));
    if (!imageItem) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // If upstream wire is connected, disconnect it — pasting an image is an
    // unambiguous "use this image now" override. Without this, Python would
    // keep using the upstream tensor and the paste would have no effect on
    // workflow output.
    const imgInputIdx = (node.inputs || []).findIndex((i) => i.name === "image");
    if (imgInputIdx >= 0 && node.inputs[imgInputIdx].link != null) {
      try { node.disconnectInput(imgInputIdx); } catch {}
    }

    // Snapshot existing graph node IDs so we can remove any LoadImage that
    // ComfyUI auto-creates from this same paste event.
    const idsBefore = new Set((app.graph?._nodes || []).map((n) => n.id));

    const blob = imageItem.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      node._pixaromaCropPaste(ev.target.result);
    };
    reader.readAsDataURL(blob);

    // Schedule a sweep for the auto-created LoadImage node (if any).
    // 50ms is enough for ComfyUI's createNode + widget setup to settle.
    setTimeout(() => {
      const after = app.graph?._nodes || [];
      for (const n of after) {
        if (idsBefore.has(n.id)) continue;
        if (n.comfyClass !== "LoadImage" && n.type !== "LoadImage") continue;
        const w = (n.widgets || []).find((x) => x.name === "image");
        const v = w?.value;
        if (typeof v === "string" && v.startsWith("pasted/")) {
          try { app.graph.remove(n); } catch {}
        }
      }
    }, 50);
  }, true); // capture phase
}

// Find the "active" PixaromaCrop node from any of the selection sources
// ComfyUI might use across versions/frontends:
//   1. app.canvas.selected_nodes  (object/array/map of selected nodes)
//   2. app.canvas.current_node    (LiteGraph's last-clicked node)
//   3. node_over                  (hovered node)
//   4. Iterate all nodes and pick one with `.is_selected` (Vue may set this)
// Returns the first one that's a Crop node with our paste hook attached.
function findActiveCropNode() {
  const c = app.canvas;
  if (!c) return null;
  const isCrop = (n) =>
    n && n.comfyClass === "PixaromaCrop" && typeof n._pixaromaCropPaste === "function";

  // 1. selected_nodes — try Object.values, Array, and Map .values()
  const sel = c.selected_nodes;
  if (sel) {
    let iter = null;
    if (Array.isArray(sel)) iter = sel;
    else if (typeof sel.values === "function") iter = Array.from(sel.values());
    else if (typeof sel === "object") iter = Object.values(sel);
    if (iter) {
      const hit = iter.find(isCrop);
      if (hit) return hit;
    }
  }

  // 2. current_node (LiteGraph internal)
  if (isCrop(c.current_node)) return c.current_node;

  // 3. node_over (hovered)
  if (isCrop(c.node_over)) return c.node_over;

  // 4. Fallback — scan all nodes for an is_selected flag
  const nodes = app.graph?._nodes || [];
  for (const n of nodes) {
    if (isCrop(n) && (n.is_selected || n.flags?.is_selected)) return n;
  }
  return null;
}

app.registerExtension({
  name: "Pixaroma.Crop",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "PixaromaCrop") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      // Re-suppress native ComfyUI preview -- ComfyUI may repopulate node.imgs
      // after execution, which would flash a strip below our custom preview.
      this.imgs = null;
      if (allow_debug) console.log("PixaromaCrop executed");
    };

    // Vue Compat #11 — onConfigure fires AFTER the workflow is fully
    // restored (links + sibling widget values), so it's the reliable
    // place to refresh the mini-preview on workflow tab switches. Without
    // this, switching back to a workflow can leave a stale upstream image
    // in the preview because setValue may fire before LoadImage's value
    // is restored, and onConnectionsChange does NOT fire for restored links.
    // We schedule both an immediate microtask refresh (fires after sync
    // configure work) AND a setTimeout backup (catches cases where Vue
    // delays sibling-widget restoration past the microtask).
    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const ret = originalOnConfigure?.apply(this, arguments);
      this.imgs = null; // prevent native preview flash on restore

      // Restore cached source URL from saved properties (Vue Compat #11).
      // Two formats supported: the new `pixaromaCropSource` (parts only —
      // we rebuild the URL with a fresh cache-buster) and the legacy
      // `pixaromaCropSourceURL` field (full URL string). node.properties is
      // populated by LiteGraph deserialize before this fires.
      if (!this._pixaromaCropSourceURL) {
        if (this.properties?.pixaromaCropSource) {
          this._pixaromaCropSourceURL = buildSourceURL(this.properties.pixaromaCropSource, true);
        } else if (this.properties?.pixaromaCropSourceURL) {
          this._pixaromaCropSourceURL = this.properties.pixaromaCropSourceURL;
        }
      }

      if (this._pixaromaCropRefresh) {
        queueMicrotask(() => this._pixaromaCropRefresh());
        setTimeout(() => this._pixaromaCropRefresh?.(), 250);
      }
      return ret;
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaCrop") return;

    node.size = [300, 380];  // taller default to fit the new panel
    node.imgs = null; // suppress native ComfyUI preview

    // Brand default colors applied globally by js/brand/index.js.

    // ── IMAGE input socket ──────────────────────────────────────────────
    // Only add if not already present (workflow restore re-creates inputs first).
    if (!(node.inputs || []).some((inp) => inp.name === "image")) {
      node.addInput("image", "IMAGE");
    }

    // ── Shared preview system ──
    const parts = createNodePreview(
      "Image Crop",
      "Pixaroma",
      "Wire an IMAGE input and Run the workflow,\nor click 'Open Crop' to load an image",
    );

    // ── State -- mirrors the hidden crop_json widget ──
    let cropJson = "{}";

    // Mini-preview rebuilder: fetch upstream image + apply saved crop client-side
    // so the node body shows the same result the Python node will return.
    const rebuildPreviewFromUpstream = () => {
      const url = getUpstreamImageURL(node);
      if (!url) return;
      // Seed lastSnap synchronously so the polling loop won't fire a
      // redundant rebuild while this one is in flight (would flash).
      lastSnap = getUpstreamSnapshot(node);
      let meta = {};
      try { meta = JSON.parse(cropJson) || {}; } catch {}

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        node._pixaromaLastImageDims = { w, h };
        // Also persist dims into cropJson so panel.mjs's dimsWithFallback()
        // has something to read after a Vue workflow tab switch / page
        // reload (the runtime field above doesn't survive — only
        // node.properties / cropJson do). Without this, opening a saved
        // workflow and immediately editing W/H computed alignment with
        // dims=null and silently produced top-left crops even with
        // "Center crop" still selected. Idempotent — only rewrites JSON
        // when the value actually changed, to avoid spurious change events.
        try {
          const metaCur = JSON.parse(cropJson || "{}") || {};
          if (metaCur.original_w !== w || metaCur.original_h !== h) {
            metaCur.original_w = w;
            metaCur.original_h = h;
            cropJson = JSON.stringify(metaCur);
            if (widget) widget.value = { crop_json: cropJson };
          }
        } catch {}
        panel?.refresh(); // panel reads dims for default-fill
        // No saved rect → show the upstream as-is (matches Python pass-through).
        if (!meta.crop_w) {
          showNodePreview(parts, url, `${w}×${h}`, node);
          return;
        }
        // Mirror nodes/node_crop.py::_crop_tensor: absolute pixel coords,
        // clamped to image bounds. No proportional rescale — typing W=430
        // means crop 430 px, regardless of source dims.
        const x0 = Math.max(0, Math.round(meta.crop_x));
        const y0 = Math.max(0, Math.round(meta.crop_y));
        const x1 = Math.min(w, Math.round(meta.crop_x + meta.crop_w));
        const y1 = Math.min(h, Math.round(meta.crop_y + meta.crop_h));
        const cw = x1 - x0;
        const ch = y1 - y0;
        if (cw <= 0 || ch <= 0) {
          showNodePreview(parts, url, `${w}×${h}`, node);
          return;
        }
        const c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        c.getContext("2d").drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);
        const dataURL = c.toDataURL("image/png");
        showNodePreview(parts, dataURL, `${cw}×${ch}`, node);
      };
      img.onerror = () => {
        if (allow_debug) console.warn("[Crop] upstream preview load failed:", url);
      };
      img.src = url;
    };

    // ── Open button ──
    node.addWidget("button", "Open Crop", null, () => {
      // Don't stack a second editor on this node (orphans the first + leaks).
      if (node._pixaromaCropEditor?.el?.overlay?.isConnected) return;
      const editor = new CropEditor();
      node._pixaromaCropEditor = editor;

      editor.onSave = (jsonStr, dataURL) => {
        cropJson = jsonStr;
        widget.value = { crop_json: jsonStr };

        if (app.graph) {
          app.graph.setDirtyCanvas(true, true);
          if (typeof app.graph.change === "function") app.graph.change();
        }

        if (dataURL) {
          showNodePreview(parts, dataURL, null, node);
        }
        panel?.refresh();
      };

      editor.onSaveToDisk = (dataURL) =>
        downloadDataURL(dataURL, "pixaroma_crop");

      // Fired when the user picks a file via the editor's "Load Image"
      // button. Disconnect any upstream IMAGE wire — same semantics as
      // the Ctrl+V paste flow (line ~140) and the on-node drag-drop
      // (line ~520). Without this, the manually-loaded image is saved
      // as src_path but Python's _crop_tensor still picks upstream and
      // the load appears to do nothing on workflow run.
      editor.onLoadImage = () => {
        const imgInputIdx = (node.inputs || []).findIndex((i) => i.name === "image");
        if (imgInputIdx >= 0 && node.inputs[imgInputIdx].link != null) {
          try { node.disconnectInput(imgInputIdx); } catch {}
        }
      };

      editor.onClose = () => {
        node._pixaromaCropEditor = null;
        node.setDirtyCanvas(true, true);
      };

      // Pass upstream URL so the editor opens with the live source image
      // when one is wired in.
      const upstreamURL = getUpstreamImageURL(node);
      editor.open(cropJson, upstreamURL);
    });

    // Forward declaration so panel callbacks can reference widget (assigned below).
    let widget;

    // ── On-node panel (W, H, X, Y, Ratio, Center — all always visible) ──
    // Mounted BEFORE the CropWidget DOM widget so it renders ABOVE the
    // mini-preview in the node body.
    const PANEL_H = 100; // 3 rows × 26 (cell + 1px border + padding) + 2 gaps × 5 + container padding 10

    const panel = createCropPanel({
      getCropJson: () => cropJson,
      setCropJson: (s) => {
        cropJson = s;
        if (widget) widget.value = { crop_json: cropJson };
      },
      getImageDims: () => node._pixaromaLastImageDims || null,
      onChange: () => {
        rebuildPreviewFromUpstream();
        if (app.graph) app.graph.setDirtyCanvas(true, true);
      },
    });
    // Resolution Pixaroma pattern — set BOTH min and max to the same constant
    // so ComfyUI doesn't stretch the widget to fill leftover node height.
    node.addDOMWidget("CropPanel", "custom", panel.el, {
      canvasOnly: true,  // hide from Parameters tab (Vue Compat #15)
      serialize: false,
      getMinHeight: () => PANEL_H,
      getMaxHeight: () => PANEL_H,
      margin: 5, // match the CropWidget mini-preview's gutter
    });

    // ── DOM widget (mini-preview) ──
    widget = node.addDOMWidget("CropWidget", "custom", parts.container, {
      canvasOnly: true,  // hide from Parameters tab (Vue Compat #15)
      getValue: () => ({ crop_json: cropJson }),
      setValue: (v) => {
        if (!v || typeof v !== "object") return;
        cropJson = v.crop_json || "{}";

        // Workflow-restore order in Vue ComfyUI: nodeCreated → setValue →
        // graph.links populated. At this point node.inputs[i].link IS set
        // (it's part of the saved node JSON), but graph.links Map may not
        // be populated yet, so getUpstreamImageURL can return null even
        // when a wire WILL be attached. Detect the pending wire via the
        // link slot and defer the rebuild a microtask.
        const imgInput = (node.inputs || []).find((i) => i.name === "image");
        const willHaveUpstream = !!(imgInput && imgInput.link != null);

        if (willHaveUpstream) {
          queueMicrotask(() => {
            if (getUpstreamImageURL(node)) {
              rebuildPreviewFromUpstream();
            } else {
              // Link slot was set but graph.links never resolved (rare).
              restoreNodePreview(parts, cropJson, node);
            }
          });
        } else {
          restoreNodePreview(parts, cropJson, node);
        }
        panel?.refresh();
      },
      getMinHeight: () => 210,
      margin: 5,
    });

    activateNodePreview(parts, node);

    // Initial panel populate from cropJson (or defaults).
    panel.refresh();

    // ── Clipboard paste support ──
    // Triggered by the window-level paste listener (installPasteHandler) when
    // this node is selected. Uploads the pasted image to input/pixaroma/ via
    // the existing crop API routes, then updates cropJson + the cached source
    // URL so the mini-preview rebuilds immediately.
    installPasteHandler();
    node._pixaromaCropPaste = async (dataURL) => {
      try {
        // Read dimensions from the dataURL.
        const dims = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = dataURL;
        });

        const projectId = "crop_paste_" + Date.now();
        // Upload as the source image (becomes src_path in cropJson).
        // Don't pre-render a composite — leave composite_path empty so the
        // Python node loads the source on every run and applies the panel's
        // current crop_w/h/x/y. This lets the user tweak crop dims after
        // pasting without re-opening the editor.
        const r1 = await api.fetchApi("/pixaroma/api/crop/upload_src", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, image: dataURL }),
        });
        const d1 = await r1.json();
        const srcPath = d1.path || "";

        const meta = {
          doc_w: dims.w,
          doc_h: dims.h,
          original_w: dims.w,
          original_h: dims.h,
          crop_x: 0,
          crop_y: 0,
          crop_w: dims.w,
          crop_h: dims.h,
          ratio_idx: 0,
          snap_idx: 0,
          crop_align: "free",
          project_id: projectId,
          composite_path: "",
          src_path: srcPath,
        };
        cropJson = JSON.stringify(meta);
        if (widget) widget.value = { crop_json: cropJson };

        // Cache the source URL so the mini-preview + editor pick it up
        // (mirrors the upstream-tensor path's URL caching).
        if (srcPath) {
          const part = {
            filename: srcPath.split(/[\\/]/).pop(),
            subfolder: "pixaroma",
            type: "input",
          };
          node._pixaromaCropSourceURL = buildSourceURL(part, true);
          if (!node.properties) node.properties = {};
          node.properties.pixaromaCropSource = part;
          delete node.properties.pixaromaCropSourceURL;
        }
        node._pixaromaLastImageDims = { w: dims.w, h: dims.h };

        rebuildPreviewFromUpstream();
        panel?.refresh();
        if (app.graph) app.graph.setDirtyCanvas(true, true);
      } catch (err) {
        console.warn("[PixaromaCrop] Paste failed:", err);
      }
    };

    // ── Drag-and-drop support ──
    // Mirrors the Ctrl+V paste flow (above): disconnect any upstream wire,
    // then route the dropped file through _pixaromaCropPaste so the upload +
    // metadata + preview rebuild path is shared. Attached to BOTH DOM widget
    // root elements (CropPanel + CropWidget mini-preview) so dropping on any
    // visible part of the node body just works. No visual overlay — the
    // recent Load Image lesson was that a "Drop here" overlay implies it's
    // the only valid target when the whole node should accept drops.
    const dropTargets = [panel?.el, parts?.container].filter(Boolean);
    const handleCropDrop = async (file) => {
      if (!file || !file.type?.startsWith("image/")) return;
      // Disconnect upstream image wire if connected — same "use this image
      // now" override semantics as the paste flow.
      const imgInputIdx = (node.inputs || []).findIndex((i) => i.name === "image");
      if (imgInputIdx >= 0 && node.inputs[imgInputIdx].link != null) {
        try { node.disconnectInput(imgInputIdx); } catch {}
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        node._pixaromaCropPaste?.(ev.target.result);
      };
      reader.readAsDataURL(file);
    };
    for (const target of dropTargets) {
      target.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
      });
      target.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer?.files?.[0];
        handleCropDrop(file);
      });
    }

    // ── Auto-refresh preview when upstream changes (Vue Compat #1) ──
    let lastSnap = "";

    // Expose refresh + reset hooks so onConfigure (Vue Compat #11) can
    // force a refresh on workflow tab switch. Resetting lastSnap lets the
    // polling loop also catch the change even if onConfigure timing is off
    // and DOM is shared across workflow tabs (architecture vs portrait).
    node._pixaromaCropRefresh = () => {
      lastSnap = ""; // force next poll to detect "change"
      if (getUpstreamImageURL(node)) {
        rebuildPreviewFromUpstream();
      } else {
        restoreNodePreview(parts, cropJson, node);
      }
      panel?.refresh();
    };

    node.onConnectionsChange = (type, slotIndex, connected) => {
      if (type !== LiteGraph.INPUT) return;
      const inputName = node.inputs?.[slotIndex]?.name;
      if (inputName !== "image") return;
      // Skip the graph-level connection replay during workflow load: it fires
      // AFTER onConfigure restored the persisted crop source, and would delete
      // it (wiping the saved preview on every open / tab switch / undo - same
      // bug class as Switch #40 / Image Resize). Genuine user wire changes
      // still invalidate the stale cached source.
      if (isGraphLoading()) return;
      // Wire changed → cached URL is stale.
      node._pixaromaCropSourceURL = null;
      if (node.properties) {
        delete node.properties.pixaromaCropSource;
        delete node.properties.pixaromaCropSourceURL;
      }
      if (connected) {
        rebuildPreviewFromUpstream();
      } else {
        // Wire removed → the upstream image is gone. Fall back to the saved
        // disk composite/src (or blank) so a stale upstream preview doesn't
        // linger and make the node look still-connected.
        restoreNodePreview(parts, cropJson, node);
      }
    };

    // Polling: don't kill the interval when node.graph is briefly null
    // (Vue tab switching can detach + reattach the node from the active
    // graph). Just skip that tick. onRemoved still kills the interval
    // when the node is genuinely deleted.
    const pollInterval = setInterval(() => {
      if (!node.graph) return;
      const snap = getUpstreamSnapshot(node);
      if (snap && snap !== lastSnap) {
        lastSnap = snap;
        rebuildPreviewFromUpstream();
      }
    }, 500);

    // ── Cache source URL emitted by Python on each execute ──
    // Works for any IMAGE upstream (VAE Decode etc.) — without this, only
    // LoadImage chains can resolve a usable preview URL.
    const onExec = (event) => {
      const detail = event?.detail;
      if (!detail?.output) return;
      // Cross-version node-id resolution (Vue passes string, legacy passes number).
      const matched = app.graph.getNodeById(detail.node)
                  || app.graph.getNodeById(parseInt(detail.node, 10));
      if (matched !== node) return;
      const frames = detail.output.pixaroma_crop_source;
      if (!frames?.length) return;
      const f = frames[0];
      const part = { filename: f.filename, subfolder: f.subfolder || "", type: f.type || "temp" };
      node._pixaromaCropSourceURL = buildSourceURL(part, true);
      if (!node.properties) node.properties = {};
      node.properties.pixaromaCropSource = part;
      // Drop the legacy full-URL field if present (back-compat cleanup).
      delete node.properties.pixaromaCropSourceURL;
      rebuildPreviewFromUpstream();
    };
    api.addEventListener("executed", onExec);

    // Refresh after every workflow execution so post-exec preview images
    // (e.g. an Img Generation upstream) flow into our mini preview.
    let executionRunning = false;
    const onStart = () => { executionRunning = true; };
    const onExecuting = (event) => {
      const detail = event?.detail;
      if (detail === null || detail?.node === null) {
        if (executionRunning) {
          executionRunning = false;
          if (getUpstreamImageURL(node)) {
            setTimeout(() => rebuildPreviewFromUpstream(), 200);
          }
        }
      }
    };
    api.addEventListener("execution_start", onStart);
    api.addEventListener("executing", onExecuting);

    const origRemoved = node.onRemoved;
    node.onRemoved = () => {
      // Tear down an open editor so its undo guard is restored + keys unbound.
      try {
        if (node._pixaromaCropEditor?.el?.overlay?.isConnected) node._pixaromaCropEditor._close();
      } catch (e) {}
      origRemoved?.call(node);
      clearInterval(pollInterval);
      try { api.removeEventListener("execution_start", onStart); } catch {}
      try { api.removeEventListener("executing", onExecuting); } catch {}
      try { api.removeEventListener("executed", onExec); } catch {}
    };
  },
});
