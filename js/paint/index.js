// ============================================================
// Pixaroma Paint Studio — Entry point (ComfyUI widget registration)
// ============================================================
import { app } from "../../../../scripts/app.js";

// Import core class first, then all mixin files (side-effect imports that add to prototype)
import { PaintStudio } from "./core.mjs";
import "./canvas.mjs";
import "./render.mjs";
import "./transform.mjs";
import "./events.mjs";
import "./tools.mjs";
import "./history.mjs";
import "./ui.mjs";

import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "../shared/index.mjs";

app.registerExtension({
  name: "Pixaroma.Paint",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "PixaromaPaint") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      if (allow_debug) console.log("PixaromaPaint executed");
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaPaint") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── Shared preview system ──
    const parts = createNodePreview(
      "Paint",
      "Pixaroma",
      "Click 'Open Paint' to start",
    );

    // ── State — mirrors the hidden paint_json widget ──
    let paintJson = "{}";

    // ── Open button ──
    node.addWidget("button", "Open Paint", null, () => {
      // Don't stack a second editor on this node — that orphans the first
      // (leaked listeners + graph patches, stacked overlays).
      if (node._pixaromaPaint?.el?.overlay?.isConnected) return;
      const studio = new PaintStudio();
      // Stash on the node so the drop-on-closed-node handler (below) can
      // route the dropped file through studio.addImageAsLayer once
      // studio.ready resolves. Cleared on close.
      node._pixaromaPaint = studio;

      studio.onSave = (jsonStr, dataURL) => {
        paintJson = jsonStr;
        widget.value = { paint_json: jsonStr };

        if (app.graph) {
          app.graph.setDirtyCanvas(true, true);
          if (typeof app.graph.change === "function") app.graph.change();
        }

        if (dataURL) {
          showNodePreview(parts, dataURL, null, node);
        }
      };

      studio.onSaveToDisk = (dataURL) =>
        downloadDataURL(dataURL, "pixaroma_paint");

      studio.onClose = () => {
        node._pixaromaPaint = null;
        node.setDirtyCanvas(true, true);
      };

      studio.open(paintJson);
    });

    // ── DOM widget ──
    let widget = node.addDOMWidget("PaintWidget", "custom", parts.container, {
      canvasOnly: true,  // hide from Parameters tab (Vue Compat #15)
      getValue: () => ({ paint_json: paintJson }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          paintJson = v.paint_json || "{}";
          restoreNodePreview(parts, paintJson, node);
        }
      },
      getMinHeight: () => 210,
      margin: 5,
    });

    // ── Drag-and-drop on the closed node ──
    // Drops always add as a NEW layer on top — never replace, never delete.
    // Mirrors the Image Composer pattern: opens the studio if it's closed,
    // waits for studio.ready (so the new layer stacks predictably above
    // any restored layers' async image loads), then routes the file
    // through the same addImageAsLayer flow the in-editor toolbar uses.
    parts.container.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
    });
    parts.container.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type?.startsWith("image/")) return;
      // Open the studio if it's not already up — reuse the existing
      // button callback so all the onSave/onSaveToDisk/onClose wiring
      // runs through one code path.
      if (!node._pixaromaPaint) {
        const openBtn = (node.widgets || []).find(
          (w) => w?.type === "button" && w?.name === "Open Paint",
        );
        if (openBtn?.callback) openBtn.callback();
      }
      const studio = node._pixaromaPaint;
      if (!studio) return;
      try {
        await studio.ready;
        studio.addImageAsLayer?.(file);
      } catch (err) {
        console.warn("[PixaromaPaint] drop add-layer failed:", err);
      }
    });

    // cleanup when node is removed
    node.onRemoved = () => {
      // Tear down an open editor so its undo guard is restored + window
      // listeners detached (deleting the node mid-edit would otherwise leak
      // them, and — now that we install the guard — leave it bricked).
      try {
        if (node._pixaromaPaint?.el?.overlay?.isConnected) node._pixaromaPaint._close();
      } catch (e) {}
      widget = null;
    };

    activateNodePreview(parts, node);
  },
});
