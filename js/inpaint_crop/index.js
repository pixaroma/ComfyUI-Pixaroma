// ============================================================
// Inpaint Crop Pixaroma — node entry (open button, preview, source, persist)
// ============================================================
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { InpaintCropEditor } from "./core.mjs";
import "./paint.mjs";   // mixin: brush / mask / keys
import "./render.mjs";  // mixin: canvas render + save
import {
  createNodePreview, showNodePreview, restoreNodePreview, activateNodePreview,
  downloadDataURL, applyAdaptiveCanvasOnly,
} from "../shared/index.mjs";

const SIZE_MODE_MAP = {
  "keep shape (long side)": "keep",
  "force size (square)": "force",
  "free (multiple only)": "free",
};

function readParams(node) {
  const g = (n) => node.widgets?.find((w) => w.name === n)?.value;
  return {
    size_mode: SIZE_MODE_MAP[g("size_mode")] || "keep",
    target: parseInt(g("target")) || 1024,
    multiple: parseInt(g("multiple")) || 8,
    context_px: g("context_px") != null ? parseInt(g("context_px")) : 24,
    mask_grow: g("mask_grow") != null ? parseInt(g("mask_grow")) : 4,
  };
}

function buildSourceURL(part, bust) {
  if (!part || !part.filename) return null;
  const url = `/view?filename=${encodeURIComponent(part.filename)}` +
    `&subfolder=${encodeURIComponent(part.subfolder || "")}` +
    `&type=${encodeURIComponent(part.type || "temp")}`;
  return bust ? `${url}&t=${Date.now()}` : url;
}

function getUpstreamImageURL(node) {
  // Prefer the LIVE wired source so a just-changed Load Image (or any live
  // preview) is what the editor opens. The cached executed-source URL below is
  // only a fallback for generative upstreams whose pixels exist solely as the
  // temp PNG the Python node saved on the last run. (Without this order,
  // swapping the Load Image file showed the PREVIOUS run's image until re-run.)
  const input = (node.inputs || []).find((i) => i.name === "image");
  const graph = node.graph;
  if (input && input.link != null && graph) {
    let link = graph.links?.[input.link];
    if (!link && typeof graph.links?.get === "function") link = graph.links.get(input.link);
    const src = link && graph.getNodeById(link.origin_id);
    if (src) {
      if (src.comfyClass === "LoadImage" || src.type === "LoadImage") {
        const w = (src.widgets || []).find((x) => x.name === "image");
        if (w && w.value) return `/view?filename=${encodeURIComponent(w.value)}&type=input&t=${Date.now()}`;
      }
      if (src.imgs && src.imgs.length > 0) {
        const img = src.imgs[link.origin_slot] || src.imgs[0];
        if (typeof img === "string") return img;
        if (img && img.src) return img.src;
      }
    }
  }
  // fallback: source PNG from the last Python execute (generative upstreams, or
  // before a live preview exists), and the paste / drag-drop / restored case.
  if (node._pixInpaintSourceURL) return node._pixInpaintSourceURL;
  return null;
}

// ── clipboard paste → selected Inpaint Crop node ──
let _pasteInstalled = false;
function installPasteHandler() {
  if (_pasteInstalled) return;
  _pasteInstalled = true;
  window.addEventListener("paste", async (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const node = findActiveNode();
    if (!node) return;
    const items = e.clipboardData?.items || [];
    const it = Array.from(items).find((x) => x.type?.startsWith("image/"));
    if (!it) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const idx = (node.inputs || []).findIndex((i) => i.name === "image");
    if (idx >= 0 && node.inputs[idx].link != null) { try { node.disconnectInput(idx); } catch {} }
    const idsBefore = new Set((app.graph?._nodes || []).map((n) => n.id));
    const blob = it.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = (ev) => node._pixInpaintPaste(ev.target.result);
    reader.readAsDataURL(blob);
    setTimeout(() => {
      for (const n of app.graph?._nodes || []) {
        if (idsBefore.has(n.id)) continue;
        if (n.comfyClass !== "LoadImage" && n.type !== "LoadImage") continue;
        const w = (n.widgets || []).find((x) => x.name === "image");
        if (typeof w?.value === "string" && w.value.startsWith("pasted/")) { try { app.graph.remove(n); } catch {} }
      }
    }, 50);
  }, true);
}

function findActiveNode() {
  const c = app.canvas;
  if (!c) return null;
  const ok = (n) => n && n.comfyClass === "PixaromaInpaintCrop" && typeof n._pixInpaintPaste === "function";
  const sel = c.selected_nodes;
  if (sel) {
    let iter = Array.isArray(sel) ? sel : (typeof sel.values === "function" ? Array.from(sel.values()) : Object.values(sel));
    const hit = iter?.find(ok);
    if (hit) return hit;
  }
  if (ok(c.current_node)) return c.current_node;
  if (ok(c.node_over)) return c.node_over;
  for (const n of app.graph?._nodes || []) if (ok(n) && (n.is_selected || n.flags?.is_selected)) return n;
  return null;
}

app.registerExtension({
  name: "Pixaroma.InpaintCrop",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaInpaintCrop") return;
    const origExec = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      origExec?.apply(this, arguments);
      this.imgs = null;
    };
    const origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const ret = origCfg?.apply(this, arguments);
      this.imgs = null;
      if (!this._pixInpaintSourceURL && this.properties?.pixInpaintSource) {
        this._pixInpaintSourceURL = buildSourceURL(this.properties.pixInpaintSource, true);
      }
      if (this._pixInpaintRefresh) {
        queueMicrotask(() => this._pixInpaintRefresh());
        setTimeout(() => this._pixInpaintRefresh?.(), 250);
      }
      return ret;
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaInpaintCrop") return;
    node.imgs = null;
    // Fresh-drop default size only; never on the load path (configure restores
    // the saved size, so writing it during load would dirty the workflow).
    if (!isGraphLoading()) node.size = [330, 500];

    if (!(node.inputs || []).some((i) => i.name === "image")) node.addInput("image", "IMAGE");
    if (!(node.inputs || []).some((i) => i.name === "mask")) node.addInput("mask", "MASK");

    const parts = createNodePreview(
      "Inpaint Crop", "Pixaroma",
      "Wire an IMAGE and Run,\nor click 'Open mask editor' to load + paint",
    );

    let stateJson = "{}";
    let widget;

    const refreshSourcePreview = () => {
      const url = getUpstreamImageURL(node);
      if (url) showNodePreview(parts, url, null, node);
    };

    // ── Open mask editor button ──
    node.addWidget("button", "Open mask editor", null, () => {
      if (node._pixInpaintEditor?.el?.overlay?.isConnected) return;
      refreshSourcePreview();   // sync the node thumbnail to the current upstream image
      const editor = new InpaintCropEditor();
      node._pixInpaintEditor = editor;
      // brush size / soft edge / opacity persist across opens on this node
      const captureBrush = () => {
        node._pixInpaintBrush = {
          brushSize: editor.brushSize, softness: editor.softness, maskOpacity: editor.maskOpacity,
        };
      };

      editor.onSave = (jsonStr, extra, preview) => {
        stateJson = jsonStr;
        if (widget) widget.value = { state_json: jsonStr };
        if (extra && extra.context_px != null) {
          const cw = node.widgets?.find((w) => w.name === "context_px");
          if (cw && cw.value !== extra.context_px) { cw.value = extra.context_px; cw.callback?.(extra.context_px); }
        }
        if (preview) showNodePreview(parts, preview, null, node);
        if (app.graph) { app.graph.setDirtyCanvas(true, true); app.graph.change?.(); }
        captureBrush();
      };
      editor.onSaveToDisk = (d) => downloadDataURL(d, "pixaroma_inpaint_crop");
      editor.onLoadImage = () => {
        const idx = (node.inputs || []).findIndex((i) => i.name === "image");
        if (idx >= 0 && node.inputs[idx].link != null) { try { node.disconnectInput(idx); } catch {} }
      };
      editor.onClose = () => { captureBrush(); node._pixInpaintEditor = null; node.setDirtyCanvas(true, true); };

      editor.open(stateJson, getUpstreamImageURL(node), readParams(node), node._pixInpaintBrush);
    });

    // ── mini-preview DOM widget (also carries the hidden state) ──
    widget = node.addDOMWidget("InpaintCropWidget", "custom", parts.container, {
      getValue: () => ({ state_json: stateJson }),
      setValue: (v) => {
        if (!v || typeof v !== "object") return;
        stateJson = v.state_json || "{}";
        const imgInput = (node.inputs || []).find((i) => i.name === "image");
        if (imgInput && imgInput.link != null) queueMicrotask(refreshSourcePreview);
        else restoreNodePreview(parts, "{}", node);
      },
      getMinHeight: () => 200,
      margin: 5,
    });
    applyAdaptiveCanvasOnly(widget);
    activateNodePreview(parts, node);

    // ── paste / drag-drop a source directly onto the node ──
    installPasteHandler();
    node._pixInpaintPaste = async (dataURL) => {
      try {
        const r = await api.fetchApi("/pixaroma/api/inpaint/upload_src", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: "inpaint_paste_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9), image: dataURL }),
        });
        const d = await r.json();
        const srcPath = d.path || "";
        let meta = {};
        try { meta = JSON.parse(stateJson) || {}; } catch {}
        meta.src_path = srcPath;
        meta.mask_path = "";  // a new source clears the old painted mask
        stateJson = JSON.stringify(meta);
        if (widget) widget.value = { state_json: stateJson };
        if (srcPath) {
          const part = { filename: srcPath.split(/[\\/]/).pop(), subfolder: "pixaroma", type: "input" };
          node._pixInpaintSourceURL = buildSourceURL(part, true);
          if (!node.properties) node.properties = {};
          node.properties.pixInpaintSource = part;
        }
        showNodePreview(parts, dataURL, null, node);
        if (app.graph) app.graph.setDirtyCanvas(true, true);
      } catch (err) { console.warn("[InpaintCrop] paste failed:", err); }
    };
    const dropTarget = parts?.container;
    if (dropTarget) {
      dropTarget.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.stopPropagation(); } });
      dropTarget.addEventListener("drop", (e) => {
        e.preventDefault(); e.stopPropagation();
        const file = e.dataTransfer?.files?.[0];
        if (!file || !file.type?.startsWith("image/")) return;
        const idx = (node.inputs || []).findIndex((i) => i.name === "image");
        if (idx >= 0 && node.inputs[idx].link != null) { try { node.disconnectInput(idx); } catch {} }
        const reader = new FileReader();
        reader.onload = (ev) => node._pixInpaintPaste(ev.target.result);
        reader.readAsDataURL(file);
      });
    }

    // ── source URL caching from Python execute + refresh hooks ──
    node._pixInpaintRefresh = () => {
      if (getUpstreamImageURL(node)) refreshSourcePreview();
      else restoreNodePreview(parts, "{}", node);
    };
    const onExec = (event) => {
      const detail = event?.detail;
      if (!detail?.output) return;
      const matched = app.graph.getNodeById(detail.node) || app.graph.getNodeById(parseInt(detail.node, 10));
      if (matched !== node) return;
      const frames = detail.output.pixaroma_inpaint_source;
      if (!frames?.length) return;
      const f = frames[0];
      const part = { filename: f.filename, subfolder: f.subfolder || "", type: f.type || "temp" };
      node._pixInpaintSourceURL = buildSourceURL(part, true);
      if (!node.properties) node.properties = {};
      node.properties.pixInpaintSource = part;
      refreshSourcePreview();
    };
    api.addEventListener("executed", onExec);

    node.onConnectionsChange = (type, slotIndex, connected) => {
      if (type !== LiteGraph.INPUT) return;
      if (node.inputs?.[slotIndex]?.name !== "image") return;
      if (isGraphLoading()) return;
      node._pixInpaintSourceURL = null;
      if (node.properties) delete node.properties.pixInpaintSource;
      if (connected) refreshSourcePreview();
      else restoreNodePreview(parts, "{}", node);
    };

    const origRemoved = node.onRemoved;
    node.onRemoved = () => {
      try { if (node._pixInpaintEditor?.el?.overlay?.isConnected) node._pixInpaintEditor._close(); } catch (e) {}
      try { parts?.resizeObserver?.disconnect(); } catch (e) {}
      origRemoved?.call(node);
      try { api.removeEventListener("executed", onExec); } catch {}
    };
  },
});
