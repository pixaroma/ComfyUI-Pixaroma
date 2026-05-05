// ============================================================
// Pixaroma Image Crop Editor — Entry Point
// ============================================================
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { CropEditor } from "./core.mjs";
import "./interaction.mjs"; // mixin: mouse/keyboard events
import "./render.mjs"; // mixin: canvas rendering, ratio, save
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
      if (this._pixaromaCropRefresh) {
        queueMicrotask(() => this._pixaromaCropRefresh());
        setTimeout(() => this._pixaromaCropRefresh?.(), 250);
      }
      return ret;
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaCrop") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── IMAGE input socket ──────────────────────────────────────────────
    // Only add if not already present (workflow restore re-creates inputs first).
    if (!(node.inputs || []).some((inp) => inp.name === "image")) {
      node.addInput("image", "IMAGE");
    }

    // ── Shared preview system ──
    const parts = createNodePreview(
      "Image Crop",
      "Pixaroma",
      "Click 'Open Crop' to start",
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
        // No saved rect → show the upstream as-is (matches Python pass-through).
        if (!meta.crop_w) {
          showNodePreview(parts, url, `${w}×${h}`, node);
          return;
        }
        // Mirror nodes/node_crop.py::_crop_tensor exactly: scale, then round
        // ENDPOINTS (not width). Subtracting rounded endpoints guarantees the
        // mini-preview dims match what Python returns -- otherwise rounding
        // the width separately can drift by 1px under scaling.
        const ow = meta.original_w || w;
        const oh = meta.original_h || h;
        const sx = w / ow, sy = h / oh;
        const x0 = Math.max(0, Math.round(meta.crop_x * sx));
        const y0 = Math.max(0, Math.round(meta.crop_y * sy));
        const x1 = Math.min(w, Math.round((meta.crop_x + meta.crop_w) * sx));
        const y1 = Math.min(h, Math.round((meta.crop_y + meta.crop_h) * sy));
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
      const editor = new CropEditor();

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
      };

      editor.onSaveToDisk = (dataURL) =>
        downloadDataURL(dataURL, "pixaroma_crop");

      editor.onClose = () => {
        node.setDirtyCanvas(true, true);
      };

      // Pass upstream URL so the editor opens with the live source image
      // when one is wired in.
      const upstreamURL = getUpstreamImageURL(node);
      editor.open(cropJson, upstreamURL);
    });

    // ── DOM widget ──
    const widget = node.addDOMWidget("CropWidget", "custom", parts.container, {
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
      },
      getMinHeight: () => 210,
      margin: 5,
    });

    activateNodePreview(parts, node);

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
    };

    node.onConnectionsChange = (type, slotIndex, connected) => {
      if (type !== LiteGraph.INPUT) return;
      const inputName = node.inputs?.[slotIndex]?.name;
      if (inputName !== "image") return;
      if (connected) {
        rebuildPreviewFromUpstream();
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
      origRemoved?.call(node);
      clearInterval(pollInterval);
      try { api.removeEventListener("execution_start", onStart); } catch {}
      try { api.removeEventListener("executing", onExecuting); } catch {}
    };
  },
});
