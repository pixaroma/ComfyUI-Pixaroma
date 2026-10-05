// ============================================================
// Pixaroma 3D Editor — Entry point (ComfyUI widget registration)
// ============================================================
import { app } from "../../../scripts/app.js";

// Import core class first, then mixin files (side-effect imports add methods to prototype)
import { Pixaroma3DEditor } from "./core.mjs";
import "./engine.mjs";
import "./shapes.mjs";  // shape registry (pure data module, no mixins)
import "./objects.mjs";
import "./shape_params.mjs";
import "./interaction.mjs";
import "./persistence.mjs";
import "./importer.mjs";
import { registerNodeAccent } from "../shared/node_settings.mjs";

import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  activateNodePreview,
  downloadDataURL,
  applyAdaptiveCanvasOnly,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { growToCoreMinHeight, capComputeSizeInNodes2 } from "../shared/core_min_size.mjs";

app.registerExtension({
  name: "Pixaroma.3DEditor",

  // No Settings-panel row: this option lives on the node itself (the gear in
  // the selection toolbar / the right-click entry). The setting id is unchanged
  // and merely unregistered, so an existing choice carries over; the read site
  // supplies the default for the unset case.

  // Handle execution result (OUTPUT_NODE = True on python side)
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "Pixaroma3D") return;
    capComputeSizeInNodes2(nodeType); // Nodes 2.0 Ctrl+Z grow on frontend 1.53 (3d-builder.md #13)

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      if (allow_debug) console.log("Pixaroma3D executed");
    };
  },

  // DOM widget creation
  async nodeCreated(node) {
    if (node.comfyClass !== "Pixaroma3D") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── Shared preview system ──
    const parts = createNodePreview(
      "3D Builder",
      "Pixaroma",
      "Click 'Open 3D Builder' to start",
    );

    // ── State ──
    let sceneJson = "{}";

    // ── Separate button widget ──
    node.addWidget("button", "Open 3D Builder", null, () => {
      // Don't stack a second editor on this node (orphans the first; each 3D
      // editor holds 2 WebGL contexts, so double-open burns toward Chrome's cap).
      if (node._pixaroma3dEditor?.el?.overlay?.isConnected) return;
      const editor = new Pixaroma3DEditor();
      node._pixaroma3dEditor = editor;

      // Apply default BG from ComfyUI settings (if user configured it).
      // ComfyUI's `color` setting type returns values without the leading
      // `#` (e.g. "c936c9"), and the legacy `text` type returns "#c936c9".
      // Accept either, and normalize to "#rrggbb".
      try {
        let custom = app.ui.settings.getSettingValue("Pixaroma.3D.DefaultBgColor");
        if (typeof custom === "string") {
          custom = custom.trim();
          if (custom && custom[0] !== "#") custom = "#" + custom;
          if (/^#[0-9a-fA-F]{6}$/.test(custom)) {
            editor.bgColor = custom;
            editor._defaultBgColor = custom;
          }
        }
      } catch {}

      editor.onSave = (jsonStr, dataURL) => {
        sceneJson = jsonStr;
        // Guard + re-lookup: ComfyUI's Vue frontend can tear down the
        // DOM widget while the editor is still open (same pattern as
        // the overlay-removal case noted in CLAUDE.md). If that
        // happens, `widget` was nulled by onRemoved. Try node.widgets
        // as a fallback — Vue may have recreated the widget under the
        // same name. If still nothing, the widget's getValue reads
        // from the `sceneJson` closure var (just refreshed) so the
        // next workflow execution still picks up fresh data.
        const w = widget || node.widgets?.find((x) => x.name === "SceneWidget");
        if (w) w.value = { scene_json: jsonStr };

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
        downloadDataURL(dataURL, "pixaroma_3d");

      editor.onClose = () => {
        node._pixaroma3dEditor = null;
        node.setDirtyCanvas(true, true);
      };

      editor.open(sceneJson);
    });

    // ── DOM widget (sent to Python as kwargs["SceneWidget"]) ──
    installCanvasZoomPassthrough(parts.container);
    let widget = node.addDOMWidget("SceneWidget", "custom", parts.container, {
      // canvasOnly set adaptively below (CLAUDE.md Nodes 2.0): true in legacy
      // (out of the Parameters tab), false in Nodes 2.0 (renders in Vue body).
      getValue: () => ({
        scene_json: sceneJson,
      }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          sceneJson = v.scene_json || "{}";
          restoreNodePreview(parts, sceneJson, node);
        }
      },
      getMinHeight: () => 210,
      margin: 5,
    });
    applyAdaptiveCanvasOnly(widget);
    // Classic fresh drop: start at core's own height (312), or the first Ctrl+Z
    // grows the node and jams undo (3d-builder.md #12).
    growToCoreMinHeight(node);

    // cleanup when node is removed
    node.onRemoved = () => {
      // Tear down an open editor so its undo guard is restored + WebGL contexts
      // released (deleting the node mid-edit would otherwise leak them).
      try {
        if (node._pixaroma3dEditor?.el?.overlay?.isConnected) node._pixaroma3dEditor._close();
      } catch (e) {}
      widget = null;
    };

    activateNodePreview(parts, node);
  },
});

// Re-export for backward compatibility
export { Pixaroma3DEditor } from "./core.mjs";

// The colour option is not offered: this node's face is ComfyUI's own grey
// button plus a preview, so there is no Pixaroma orange on it to change. The
// panel exists purely to host the scene background, which used to sit in the
// global Settings panel.
registerNodeAccent("Pixaroma3D", {
  title: "3D Builder",
  accent: false,
  rows: [
    { kind: "color", setting: "Pixaroma.3D.DefaultBgColor", defaultValue: "#6e6e6e",
      label: "Background colour for new scenes",
      hint: "The colour a fresh 3D scene starts on. Existing scenes keep theirs." },
  ],
});
