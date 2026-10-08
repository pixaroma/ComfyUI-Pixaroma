// Load Texts from Folder Pixaroma - frontend: a "Browse folder" button under the
// folder field. Everything else is native widgets, so the node looks and sizes
// the same in Classic and Nodes 2.0. Python: nodes/node_load_texts_folder.py.

import { app } from "../../../scripts/app.js";
import { pickFolderInto } from "../shared/folder_pick.mjs";

const COMFY_CLASS = "PixaromaLoadTextsFolder";

app.registerExtension({
  name: "Pixaroma.LoadTextsFolder",
  nodeCreated(node) {
    if (node.comfyClass !== COMFY_CLASS) return;
    // Appended AFTER the native folder widget, never before it (VC#23), and a
    // button carries no value, so widgets_values keeps its shape.
    const btn = node.addWidget("button", "Browse folder", null, () => {
      pickFolderInto(node, "folder", "Load Texts from Folder");
    });
    if (btn) {
      btn.serialize = false;
      btn.options = { ...(btn.options || {}), serialize: false };
    }
  },
});
