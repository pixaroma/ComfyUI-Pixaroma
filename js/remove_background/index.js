// Remove Background Pixaroma - the node is pure Python; this file only fixes its
// fresh-drop width.
//
// Core hands a fresh Remove Background a fractional width (301.80625, from its
// title and model list). Nodes 2.0 re-measures a fractional width a hair narrower
// on every Ctrl+Z (301.8 -> 301.78), so the next click recorded a new undo step
// and wiped redo: the undo jam the all-nodes live suite found (2026-10-04, the same
// fix as Krea LoRA Convert). A whole-pixel width measures back exactly.

import { app } from "../../../scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";

app.registerExtension({
  name: "Pixaroma.RemoveBackground",

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaRemoveBackground") return;
    // Fresh drop only: configure() restores a saved size after this, and the load
    // path writes nothing (VC#18).
    if (!isGraphLoading() && node.size) node.size[0] = Math.round(node.size[0]);
  },
});
