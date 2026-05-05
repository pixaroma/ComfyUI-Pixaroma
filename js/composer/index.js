import { app } from "../../../../scripts/app.js";
// api is used at the top level (pixaroma-composer-preview WebSocket
// listener) AND inside the execution-events try block further down.
// Importing it once here keeps both call sites using the same module.
import { api } from "../../../../scripts/api.js";
import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "../shared/index.mjs";

// Import core class first, then mixins as side-effects
import { PixaromaEditor } from "./core.mjs";
import "./eraser.mjs";
import "./render.mjs";
import "./interaction.mjs";
import "./placeholder.mjs";
import { getUpstreamImageUrlForNode } from "./placeholder.mjs";

// Re-export so other modules can import from index
export { PixaromaEditor };

// ── DEBUG — set to true to trace preview updates in the console ──
const DBG = false;
function dbg(...args) { if (DBG) console.log("[PXR-DEBUG]", ...args); }

// Same mapping used by the in-editor canvas (see composer/render.mjs).
// Must stay in sync — the mini-preview client recomposite needs to
// honor blend modes, or it overwrites the correct save with a
// Normal-only render after execution.
const BLEND_MAP = {
  Normal: "source-over",
  Multiply: "multiply",
  Screen: "screen",
  Overlay: "overlay",
  Darken: "darken",
  Lighten: "lighten",
  "Color Dodge": "color-dodge",
  "Color Burn": "color-burn",
  "Hard Light": "hard-light",
  "Soft Light": "soft-light",
  Difference: "difference",
  Exclusion: "exclusion",
  Hue: "hue",
  Saturation: "saturation",
  Color: "color",
  Luminosity: "luminosity",
};

// Check if the editor is truly open (overlay is in the DOM)
function isEditorOpen(node) {
  if (!node._pixaromaEditor) return false;
  const overlay = node._pixaromaEditor.overlay;
  if (!overlay || !overlay.isConnected) {
    // Editor was removed from DOM without close handler — clean up
    dbg("editor overlay gone — clearing stale reference");
    node._pixaromaEditor = null;
    return false;
  }
  return true;
}

app.registerExtension({
  name: "Pixaroma.ImageComposer",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "PixaromaImageComposition") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      dbg("onExecuted fired", { hasRebuild: !!this._pixaromaRebuildPreview, editorOpen: isEditorOpen(this) });
      // If the "pixaroma-composer-preview" WebSocket event already
      // pushed the correct server-rendered image into our top
      // preview (dynamic re-compose path: placeholders / auto-rembg
      // / masks), DO NOT run rebuildPreview — it would re-composite
      // the raw upstream images client-side without rembg and
      // overwrite the good result with the wrong one.
      //
      // The flag is set by _onComposerPreview and cleared on
      // execution_start so the next run starts fresh.
      if (this._pixaromaWsPreviewApplied) {
        dbg("onExecuted → WS preview already applied, skipping rebuild");
        return;
      }
      // Fast-path fallback (no placeholders / auto-rembg / masks):
      // Python loaded the pre-baked composite PNG and didn't send a
      // custom event — so rebuild client-side from current inputs.
      if (this._pixaromaRebuildPreview && !isEditorOpen(this)) {
        const rebuild = this._pixaromaRebuildPreview;
        setTimeout(() => { dbg("onExecuted → delayed rebuildPreview"); rebuild(); }, 300);
      }
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaImageComposition") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── Shared preview system ──
    const parts = createNodePreview(
      "Image Composer",
      "Pixaroma",
      "Click 'Open Image Composer' to start",
    );

    // ── State — mirrors the hidden project_json widget ──
    let projectJson = "{}";

    // ── Open button ──
    node.addWidget("button", "Open Image Composer", null, () => {
      const editor = new PixaromaEditor(node);
      node._pixaromaEditor = editor;

      editor.onSave = (jsonStr, dataURL) => {
        dbg("editor.onSave", { jsonLen: jsonStr.length, hasDataURL: !!dataURL, editorOpen: !!node._pixaromaEditor });
        projectJson = jsonStr;
        widget.value = { project_json: jsonStr };

        if (dataURL) {
          let dimText = null;
          try {
            const meta = JSON.parse(jsonStr);
            dimText = `${meta.doc_w || "?"}\u00d7${meta.doc_h || "?"}`;
          } catch {}
          showNodePreview(parts, dataURL, dimText, node);
        }

        node.setDirtyCanvas(true, true);
      };

      editor.onSaveToDisk = (dataURL) =>
        downloadDataURL(dataURL, "pixaroma_composer");

      editor.onClose = () => {
        dbg("editor.onClose");
        editor.syncNodeInputs();
        node._pixaromaEditor = null;
        _lastUpstreamSnapshot = "";
        node.setDirtyCanvas(true, true);
      };
    });

    // ── DOM widget ──
    let widget = node.addDOMWidget(
      "ComposerWidget",
      "custom",
      parts.container,
      {
        getValue: () => ({ project_json: projectJson }),
        setValue: (v) => {
          dbg("setValue called", { type: typeof v, hasProjectJson: !!(v && v.project_json), projectJsonLen: v?.project_json?.length });
          if (v && typeof v === "object" && v.project_json) {
            const incoming = v.project_json;
            if (incoming && incoming !== "{}" && incoming !== projectJson) {
              dbg("setValue → updating projectJson", { oldLen: projectJson.length, newLen: incoming.length });
              projectJson = incoming;
            }
            let hasPlaceholders = false;
            try {
              const m = JSON.parse(projectJson);
              hasPlaceholders = (m.layers || []).some((l) => l.isPlaceholder);
            } catch {}
            dbg("setValue → hasPlaceholders:", hasPlaceholders, "editorOpen:", isEditorOpen(node));
            if (isEditorOpen(node)) {
              // Editor is open — it handles its own preview, skip rebuild
            } else if (hasPlaceholders) {
              rebuildPreview();
            } else {
              restoreNodePreview(parts, projectJson, node);
            }
          }
        },
        getMinHeight: () => 210,
        margin: 5,
      },
    );

    // cleanup handled in API listener section below

    // Default auto-preview
    node._pixaromaAutoPreview = true;

    // Full re-composite: render all layers in z-order, replacing connected
    // placeholders with their upstream image (respecting fill mode).
    const rebuildPreview = () => {
      let meta;
      try { meta = JSON.parse(projectJson); } catch {
        dbg("rebuildPreview → JSON parse failed");
        return;
      }
      if (!meta) { dbg("rebuildPreview → meta is null"); return; }

      const docW = meta.doc_w || 1024;
      const docH = meta.doc_h || 1024;
      const layers = meta.layers || [];
      if (layers.length === 0) {
        dbg("rebuildPreview → no layers, projectJson starts with:", projectJson.substring(0, 100));
        return;
      }

      dbg("rebuildPreview → processing", layers.length, "layers");

      // Build load list for every visible layer
      const loadList = [];
      for (const layer of layers) {
        if (layer.visible === false) { loadList.push({ layer, url: null, maskUrl: null }); continue; }
        let maskUrl = null;
        if (layer.maskSrc) {
          const maskFn = layer.maskSrc.split(/[\\/]/).pop();
          maskUrl = `/view?filename=${encodeURIComponent(maskFn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
        }
        if (layer.isPlaceholder) {
          const url = getUpstreamImageUrlForNode(node, `image_${layer.inputIndex}`);
          dbg("  placeholder layer", layer.name, "→ url:", url ? url.substring(0, 80) : "NULL");
          loadList.push({ layer, url, maskUrl, isPlaceholder: true });
        } else {
          const src = layer.src;
          if (!src || src === "__placeholder__") { loadList.push({ layer, url: null, maskUrl: null }); continue; }
          const fn = src.split(/[\\/]/).pop();
          const url = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
          dbg("  regular layer", layer.name, "→ url:", url.substring(0, 80));
          loadList.push({ layer, url, maskUrl });
        }
      }

      // Load all images + masks
      const images = new Array(loadList.length);
      const maskImages = new Array(loadList.length);
      let pending = 0;
      loadList.forEach((item) => { if (item.url) pending++; if (item.maskUrl) pending++; });
      dbg("rebuildPreview → pending image loads:", pending);
      if (pending === 0) { dbg("rebuildPreview → no images to load, compositing immediately"); compositeAll(); return; }

      let done = 0;
      const check = () => {
        if (++done === pending) {
          dbg("rebuildPreview → all images loaded, compositing");
          compositeAll();
        }
      };
      loadList.forEach((item, i) => {
        if (item.url) {
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.onload = () => { images[i] = img; dbg("  img loaded", i, img.naturalWidth + "x" + img.naturalHeight); check(); };
          img.onerror = (e) => { dbg("  img FAILED", i, item.url.substring(0, 80)); check(); };
          img.src = item.url;
        }
        if (item.maskUrl) {
          const msk = new Image();
          msk.crossOrigin = "Anonymous";
          msk.onload = () => { maskImages[i] = msk; check(); };
          msk.onerror = check;
          msk.src = item.maskUrl;
        }
      });

      function applyFillMode(img, phW, phH, mode) {
        const c = document.createElement("canvas");
        c.width = phW; c.height = phH;
        const ctx = c.getContext("2d");
        const sw = img.naturalWidth, sh = img.naturalHeight;
        if (mode === "fill") {
          ctx.drawImage(img, 0, 0, phW, phH);
        } else if (mode === "contain") {
          const s = Math.min(phW / sw, phH / sh);
          const dw = sw * s, dh = sh * s;
          ctx.drawImage(img, (phW - dw) / 2, (phH - dh) / 2, dw, dh);
        } else {
          const s = Math.max(phW / sw, phH / sh);
          const dw = sw * s, dh = sh * s;
          ctx.drawImage(img, (phW - dw) / 2, (phH - dh) / 2, dw, dh);
        }
        return c;
      }

      function drawLayer(ctx, layer, img, maskImg) {
        const natW = img.naturalWidth || img.width;
        const natH = img.naturalHeight || img.height;
        const sx = Math.abs(layer.scaleX || 1), sy = Math.abs(layer.scaleY || 1);
        const w = natW * sx, h = natH * sy;

        let src = img;
        if (maskImg) {
          const tc = document.createElement("canvas");
          tc.width = natW; tc.height = natH;
          const tCtx = tc.getContext("2d");
          tCtx.drawImage(img, 0, 0);
          tCtx.globalCompositeOperation = "destination-out";
          tCtx.drawImage(maskImg, 0, 0, natW, natH);
          src = tc;
        }

        const cx = layer.cx ?? docW / 2, cy = layer.cy ?? docH / 2;
        const rot = (layer.rotation || 0) * Math.PI / 180;
        ctx.save();
        ctx.globalAlpha = layer.opacity ?? 1;
        if (layer.blendMode && BLEND_MAP[layer.blendMode])
          ctx.globalCompositeOperation = BLEND_MAP[layer.blendMode];
        if (layer.blur && layer.blur > 0)
          ctx.filter = "blur(" + layer.blur + "px)";
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1);
        ctx.drawImage(src, -w / 2, -h / 2, w, h);
        ctx.restore();
      }

      function compositeAll() {
        const cvs = document.createElement("canvas");
        cvs.width = docW; cvs.height = docH;
        const ctx = cvs.getContext("2d");

        loadList.forEach((item, i) => {
          if (item.layer.visible === false) return;
          const img = images[i];
          const mask = maskImages[i] || null;

          if (item.isPlaceholder) {
            if (img) {
              const phW = item.layer.naturalWidth || Math.round(docW / 2);
              const phH = item.layer.naturalHeight || Math.round(docH / 2);
              const fitted = applyFillMode(img, phW, phH, item.layer.fillMode || "cover");
              drawLayer(ctx, item.layer, fitted, mask);
            } else {
              const phW = item.layer.naturalWidth || Math.round(docW / 2);
              const phH = item.layer.naturalHeight || Math.round(docH / 2);
              const color = item.layer.placeholderColor || "#808080";
              const pc = document.createElement("canvas");
              pc.width = phW; pc.height = phH;
              const pCtx = pc.getContext("2d");
              pCtx.fillStyle = color;
              pCtx.fillRect(0, 0, phW, phH);
              const fontSize = Math.max(14, Math.min(phW, phH) / 6);
              pCtx.font = `bold ${fontSize}px Arial, sans-serif`;
              pCtx.textAlign = "center";
              pCtx.textBaseline = "middle";
              pCtx.fillStyle = "rgba(255,255,255,0.85)";
              pCtx.fillText(item.layer.name || `image_${item.layer.inputIndex}`, phW / 2, phH / 2);
              drawLayer(ctx, item.layer, pc);
            }
          } else if (img) {
            drawLayer(ctx, item.layer, img, mask);
          }
        });

        const dataURL = cvs.toDataURL("image/png");
        const dimText = `${docW}\u00d7${docH}`;
        dbg("compositeAll → calling showNodePreview, dataURL length:", dataURL.length);
        showNodePreview(parts, dataURL, dimText, node);
      }
    };

    // Expose for onExecuted
    node._pixaromaRebuildPreview = rebuildPreview;

    // Preferred onExecuted path: Python sends back the exact final
    // composed PNG via the ui.images channel. This helper fetches it
    // and pushes it to the node's mini preview — no client-side
    // re-compositing needed, and critically it includes any server-
    // applied auto-rembg so the mini preview matches downstream
    // PreviewImage nodes.
    node._pixaromaShowPreviewFromUI = (uiImage) => {
      if (!uiImage || !uiImage.filename) return;
      const params = new URLSearchParams({
        filename: uiImage.filename,
        type: uiImage.type || "temp",
        subfolder: uiImage.subfolder || "",
        // Cache-bust so the same filename with different content reloads.
        t: Date.now(),
      });
      const url = `/view?${params.toString()}`;
      // Pull dims from the current project json so the label reads right.
      let dimText = null;
      try {
        const meta = JSON.parse(projectJson);
        if (meta && meta.doc_w && meta.doc_h) {
          dimText = `${meta.doc_w}\u00d7${meta.doc_h}`;
        }
      } catch {}
      dbg("pixaromaShowPreviewFromUI → loading", url);
      showNodePreview(parts, url, dimText, node);
    };

    // Listen for the server-side "pixaroma-composer-preview" event the
    // Python node sends after a dynamic re-compose (placeholders /
    // auto-rembg / masks). It carries the filename of the exact PNG
    // that was baked as the workflow output, so we can push that same
    // image into this node's top preview. Scoped to this node via
    // project_id so multiple composer nodes in the same workflow
    // don't clobber each other.
    const _onComposerPreview = (event) => {
      const data = event?.detail;
      if (!data || !data.filename) return;
      // Match the event to this node. If project_id is missing (shouldn't
      // happen but defensive), fall back to accepting the event so a
      // single-node workflow still works.
      let myProjectId = null;
      try {
        myProjectId = JSON.parse(projectJson)?.project_id || null;
      } catch {}
      if (data.project_id && myProjectId && data.project_id !== myProjectId) return;
      if (isEditorOpen(node)) return; // don't fight the editor's own saves
      node._pixaromaShowPreviewFromUI({
        filename: data.filename,
        subfolder: data.subfolder,
        type: data.type,
      });
      // Flag the node so onExecuted (which fires AFTER this WS event)
      // knows the preview is already correct and skips its fallback
      // rebuildPreview call — otherwise it would overwrite this
      // server-rendered image with a client-side recomposite that
      // doesn't include auto-rembg, causing the "good image flashes
      // then goes bad" symptom.
      node._pixaromaWsPreviewApplied = true;
    };
    api.addEventListener("pixaroma-composer-preview", _onComposerPreview);

    node.onConnectionsChange = (type, slotIndex, connected) => {
      if (type !== LiteGraph.INPUT) return;
      const inputName = node.inputs?.[slotIndex]?.name;
      if (!inputName || !inputName.startsWith("image_")) return;

      dbg("onConnectionsChange", inputName, connected);
      if (isEditorOpen(node)) {
        node._pixaromaEditor.ui.updateActiveLayerUI();
      } else if (node._pixaromaAutoPreview) {
        rebuildPreview();
      }
    };

    // ── Auto-detect upstream image changes via polling ──
    // onDrawForeground doesn't fire in Vue-based ComfyUI, so use setInterval
    let _lastUpstreamSnapshot = "";

    function getUpstreamSnapshot() {
      const inputs = node.inputs || [];
      const pieces = [];
      const graph = node.graph;
      if (!graph) return "";
      for (const inp of inputs) {
        if (!inp.name?.startsWith("image_") || inp.link == null) continue;
        // Support both plain object and Map for graph.links
        let link = graph.links?.[inp.link];
        if (!link && typeof graph.links?.get === "function") link = graph.links.get(inp.link);
        if (!link) continue;
        const src = graph.getNodeById(link.origin_id);
        if (!src) continue;
        if (src.comfyClass === "LoadImage" || src.type === "LoadImage") {
          const w = src.widgets?.find((w) => w.name === "image");
          if (w) pieces.push(`${inp.name}=${w.value}`);
        }
        if (src.imgs?.length) {
          const img = src.imgs[link.origin_slot] || src.imgs[0];
          const s = typeof img === "string" ? img : img?.src || "";
          pieces.push(`${inp.name}_prev=${s}`);
        }
      }
      return pieces.join("|");
    }

    // Poll every 500ms for upstream changes (widget swaps, execution results)
    const pollInterval = setInterval(() => {
      if (!node.graph) { clearInterval(pollInterval); return; }
      if (!node._pixaromaAutoPreview || isEditorOpen(node)) return;
      const snap = getUpstreamSnapshot();
      if (snap && snap !== _lastUpstreamSnapshot) {
        dbg("poll → snapshot changed", { old: _lastUpstreamSnapshot.substring(0, 60), new: snap.substring(0, 60) });
        _lastUpstreamSnapshot = snap;
        // If the server-side WS event already applied the correct
        // post-execute preview (dynamic compose path), don't undo it
        // by rebuilding client-side from raw upstream images. The
        // snapshot update that triggered this poll is just the
        // upstream LoadImage getting its exec result — not a real
        // user-initiated change. Keep _lastUpstreamSnapshot updated
        // so a later genuine change is detected.
        if (node._pixaromaWsPreviewApplied) {
          dbg("poll → WS preview already applied, skipping rebuild");
          return;
        }
        rebuildPreview();
      }
    }, 500);

    // ── Listen for ComfyUI API execution events to auto-rebuild preview ──
    try {
      // `api` already imported at top of file — no need for dynamic import.

      let executionRunning = false;
      api.addEventListener("execution_start", () => {
        executionRunning = true;
        // Reset the WS-preview flag so if this run doesn't hit the
        // dynamic re-compose path (no placeholders / auto-rembg /
        // masks), onExecuted falls back to rebuildPreview correctly.
        node._pixaromaWsPreviewApplied = false;
      });

      // "executing" with null detail means execution finished
      api.addEventListener("executing", (event) => {
        const detail = event?.detail;
        if (detail === null || detail?.node === null) {
          if (executionRunning && !isEditorOpen(node)) {
            executionRunning = false;
            // Same gate as onExecuted and the poll: if the WS event
            // already pushed the correct server-rendered preview,
            // don't clobber it with a client-side recomposite.
            if (node._pixaromaWsPreviewApplied) {
              dbg("executing-null → WS preview already applied, skipping rebuild");
              return;
            }
            setTimeout(() => rebuildPreview(), 200);
          }
        }
      });

      const origRemoved = node.onRemoved;
      node.onRemoved = () => {
        origRemoved?.call(node);
        clearInterval(pollInterval);
        // Detach the preview WebSocket listener so removed nodes don't
        // leak event handlers / update phantom previews on later runs.
        try {
          api.removeEventListener("pixaroma-composer-preview", _onComposerPreview);
        } catch {}
        widget = null;
      };
    } catch (e) {
      dbg("Failed to register API event listeners:", e);
    }

    activateNodePreview(parts, node);
  },
});
